"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import dbConnect from "@/lib/db-connect";
import AccountModel from "@/models/account";
import BusinessModel from "@/models/business";
import InvoiceModel from "@/models/invoice";
import FeedbackModel from "@/models/feedback";
import DeletedAccountModel from "@/models/deleted-account";

export async function deleteUserAccount() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return { success: false, message: "Unauthorized" };
    }

    await dbConnect();

    // Find account by email - fetch _id and email
    const account = await AccountModel.findOne({
      email: session.user.email,
    })
      .select("_id email")
      .lean();

    if (!account) {
      return { success: false, message: "Account not found" };
    }

    // Find business by account - only fetch _id
    const business = await BusinessModel.findOne({
      account: account._id,
    })
      .select("_id")
      .lean();

    if (!business) {
      return { success: false, message: "Business not found" };
    }

    // Create deleted account record
    const deletedAccount = await DeletedAccountModel.create({
      email: account.email,
      deletionDate: new Date(),
    });

    if (!deletedAccount) {
      return { success: false, message: "Failed to process account deletion" };
    }

    // Delete all related data
    await Promise.all([
      AccountModel.findByIdAndDelete(account._id),
      BusinessModel.findByIdAndDelete(business._id),
      InvoiceModel.deleteMany({ business: business._id }),
      FeedbackModel.deleteMany({ givenTo: business._id }),
    ]);

    return { success: true, message: "Account deleted successfully" };
  } catch (error) {
    console.error("Account deletion error:", error);
    return { success: false, message: "Account deletion failed" };
  }
}
