import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/dbConnect";
import OwnerModel from "@/models/Owner";
import { deleteOldInvoicePdfs } from "@/utils/deleteOldInvoicesFromCloudinary";
import sendVerificationEmail from "@/utils/sendVerificationEmail";
import DeletedAccountModel from "@/models/DeletedAccount";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        await dbConnect();

        try {
          const user = await OwnerModel.findOne({
            $or: [
              { email: credentials.identifier },
              { username: credentials.identifier },
            ],
          });

          if (!user) {
            throw new Error("User not found with this email or username");
          }

          if (user?.isGoogleAuth) {
            throw new Error(
              "You have signed up with Google. Please sign in using Google."
            );
          }

          if (!user.isVerified) {
            const verifyCode = Math.floor(
              100000 + Math.random() * 900000
            ).toString();
            user.verifyCode = verifyCode;
            user.verifyCodeExpiry = new Date(Date.now() + 3600000); // 1 hour expiry
            await user.save();
            const emailResponse = await sendVerificationEmail(
              user.email,
              verifyCode
            );
            if (!emailResponse.success) {
              throw new Error(emailResponse.message);
            }
            throw new Error(`UNVERIFIED_USER:${user.username}`);
          }

          const isPasswordCorrect = await bcrypt.compare(
            credentials.password,
            user.password
          );

          if (!isPasswordCorrect) {
            throw new Error("Incorrect password");
          }

          // Delete old invoice PDFs (older than 15 minutes)
          await deleteOldInvoicePdfs(user.username);

          return {
            ...user.toObject(),
            id: user._id.toString(),
          };
        } catch (err) {
          throw new Error(err.message);
        }
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        await dbConnect();

        try {
          // Check if user exists
          const existingUser = await OwnerModel.findOne({ email: user.email });

          if (existingUser) {
            // ⚡ Check if user originally signed up with credentials
            if (!existingUser.isGoogleAuth) {
              return `/sign-in?error=DIFFERENT_SIGNIN_METHOD`;
            }

            // Delete old invoice PDFs (older than 15 minutes)
            await deleteOldInvoicePdfs(existingUser.username);

            // ✅ Allow sign-in if it's a valid Google user
            user.id = existingUser._id.toString();
            user.businessName = existingUser.businessName;
            user.username = existingUser.username;
            user.isProfileCompleted = existingUser.isProfileCompleted;
            user.phoneNumber = existingUser.phoneNumber;
            user.address = existingUser.address;
            user.gstinDetails = existingUser.gstinDetails;
            user.plan = existingUser.plan;
            user.proTrialUsed = existingUser.proTrialUsed;

            return true;
          }

          // 🔹 New Google Sign-up (Create user)
          const deletedAccount = await DeletedAccountModel.findOne({
            email: user.email,
          });
          if (
            deletedAccount &&
            deletedAccount.deletionDate &&
            deletedAccount.deletionDate.getTime() + 15 * 24 * 60 * 60 * 1000 >
              new Date().getTime()
          ) {
            const remainingMs =
              deletedAccount.deletionDate.getTime() +
              15 * 24 * 60 * 60 * 1000 -
              new Date().getTime();
            const remainingDays = Math.ceil(
              remainingMs / (24 * 60 * 60 * 1000)
            );
            return `/sign-in?error=ACCOUNT_DELETED&remainingDays=${remainingDays}`;
          }

          if (
            deletedAccount &&
            deletedAccount.deletionDate &&
            deletedAccount.deletionDate.getTime() + 15 * 24 * 60 * 60 * 1000 <
              new Date().getTime()
          ) {
            await DeletedAccountModel.findByIdAndDelete(deletedAccount._id);
          }

          const baseUsername = user.email.split("@")[0];
          let username = baseUsername;
          let counter = 1;

          while (await OwnerModel.findOne({ username })) {
            username = `${baseUsername}${counter}`;
            counter++;
          }

          const newUser = await OwnerModel.create({
            email: user.email,
            businessName: user.name || "",
            username: username,
            password: await bcrypt.hash(Math.random().toString(36), 10),
            verifyCode: "GOOGLE_AUTH",
            verifyCodeExpiry: new Date(),
            isVerified: true,
            gstinDetails: {
              gstinVerificationStatus: false,
              gstinNumber: "",
              gstinVerificationResponse: null,
            },
            isGoogleAuth: true,
            isProfileCompleted: "pending",
            phoneNumber: "",
            address: {
              localAddress: "",
              city: "",
              state: "",
              country: "",
              pincode: "",
            },
          });

          user.id = newUser._id.toString();
          user.username = username;
          user.businessName = newUser.businessName;
          user.isProfileCompleted = newUser.isProfileCompleted;
          user.phoneNumber = newUser.phoneNumber;
          user.address = newUser.address;
          user.gstinDetails = newUser.gstinDetails;
          user.plan = newUser.plan;
          user.proTrialUsed = newUser.proTrialUsed;
          return true;
        } catch (error) {
          console.error("Google Sign-In Error:", error);
          return `/sign-in`;
        }
      }

      return true;
    },

    async jwt({ token, user, account, profile, session, trigger }) {
      if (user && account) {
        // Initial sign in
        token.id = user.id;
        token.provider = account.provider;
        token.username = user.username;
        token.gstinDetails = user.gstinDetails;
        token.businessName = user.businessName;
        token.isProfileCompleted = user.isProfileCompleted || "pending";
        token.phoneNumber = user.phoneNumber;
        token.address = user.address;
        token.plan = user.plan;
        token.proTrialUsed = user.proTrialUsed;

        if (account.provider === "google") {
          token.email = profile.email;
        }
      }

      // Check if plan has expired and update if needed
      if (
        token.plan?.planName === "pro" ||
        token.plan?.planName === "pro-trial"
      ) {
        const now = new Date();
        if (new Date(token.plan.planEndDate) < now) {
          try {
            await dbConnect();
            const user = await OwnerModel.findById(token.id);
            if (user) {
              user.plan = {
                planName: "free",
                planStartDate: null,
                planEndDate: null,
              };
              await user.save();
              token.plan = user.plan;
            }
          } catch (error) {
            console.error("Error updating expired plan:", error);
          }
        }
      }

      // Handle session update
      if (trigger === "update" && session?.user) {
        token.isProfileCompleted = session.user.isProfileCompleted || "pending";
        token.businessName = session.user.businessName;
        token.gstinDetails = session.user.gstinDetails;
        token.phoneNumber = session.user.phoneNumber;
        token.address = session.user.address;
        token.plan = session.user.plan;
        token.proTrialUsed = session.user.proTrialUsed;
      }

      return token;
    },

    async session({ session, token, trigger }) {
      if (token) {
        session.user.id = token.id;
        session.user.email = token.email;
        session.user.businessName = token.businessName;
        session.user.isProfileCompleted = token.isProfileCompleted || "pending";
        session.user.gstinDetails = token.gstinDetails;
        session.user.username = token.username;
        session.user.phoneNumber = token.phoneNumber;
        session.user.address = token.address;
        session.user.plan = token.plan;
        session.user.proTrialUsed = token.proTrialUsed;
      }
      return session;
    },

    async redirect({ url, baseUrl, token }) {
      // If the url starts with /user, we need to append the username
      if (url.includes("/user")) {
        // If we have a token with username, use it
        if (token?.username) {
          return `${baseUrl}/user/${token.username}/generate`;
        }

        // If we have a token with email, try to get username from database
        if (token?.email) {
          try {
            const user = await OwnerModel.findOne({ email: token.email });
            if (user?.username) {
              return `${baseUrl}/user/${user.username}/generate`;
            }
          } catch (error) {
            console.error("Error getting username from database:", error);
          }
        }

        // If all else fails, redirect to /user
        return `${baseUrl}/user`;
      }

      // Default NextAuth redirect behavior
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },

  pages: {
    signIn: "/sign-in",
    error: "/sign-in", // Add error page redirect
  },

  session: {
    strategy: "jwt",
    maxAge: parseInt(process.env.SESSION_MAX_AGE),
    updateAge: parseInt(process.env.SESSION_UPDATE_AGE),
  },

  secret: process.env.NEXTAUTH_SECRET,
};
