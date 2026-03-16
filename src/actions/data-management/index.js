"use server";

import dbConnect from "@/lib/db-connect";
import AccountModel from "@/models/account";
import BusinessModel from "@/models/business";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import FeedbackModel from "@/models/feedback";
import InvoiceModel from "@/models/invoice";
import RecommendedActionModel from "@/models/recommended-action";
import DeletedAccountModel from "@/models/deleted-account";

export async function resetData() {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    const username = session?.user?.username;

    if (!username) {
      return { success: false, message: "Unauthorized" };
    }

    // Find account by username - only fetch _id
    const account = await AccountModel.findOne({ username })
      .select("_id")
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

    // Delete recommended actions
    await RecommendedActionModel.deleteMany({
      business: business._id,
    });

    // Delete feedbacks
    await FeedbackModel.deleteMany({
      givenTo: business._id,
    });

    // Delete invoices
    await InvoiceModel.deleteMany({ business: business._id });

    return {
      success: true,
      message: "Data reset successfully",
    };
  } catch (error) {
    console.error("Error resetting data:", error);
    return { success: false, message: "Internal server error" };
  }
}

export async function deleteAccount() {
  await dbConnect();
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return { success: false, message: "Unauthorized" };
    }

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

    const deletedAccount = await DeletedAccountModel.create({
      email: session.user.email,
      deletionDate: new Date(),
    });

    if (!deletedAccount) {
      return { success: false, message: "Failed to delete account" };
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
    console.error("Error deleting account:", error);
    return { success: false, message: "Internal server error" };
  }
}
