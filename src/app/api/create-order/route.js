import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getRazorpay } from "@/lib/razorpay";
import OwnerModel from "@/models/Owner";
import { authOptions } from "../auth/[...nextauth]/options";
import { getServerSession } from "next-auth";

export async function POST(req) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    const user = await OwnerModel.findById(session.user.id);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );
    }

    // Check if user already has a pro plan
    if (user.plan?.planName === "pro") {
      return NextResponse.json(
        { success: false, message: "User already has a Pro plan" },
        { status: 400 }
      );
    }

    // const { amount, currency = "INR" } = await req.json();
    const amount = process.env.SUBSCRIPTION_AMOUNT;
    const currency = "INR";

    const options = {
      amount: amount * 100, // Convert to paise
      currency,
      receipt: `receipt_${Date.now()}`,
    };

    const order = await getRazorpay().orders.create(options);

    return NextResponse.json(
      {
        success: true,
        order,
        message: "Order created successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to create order",
      },
      { status: 500 }
    );
  }
}
