import dbConnect from "@/lib/dbConnect";
import FeedbackModel from "@/models/Feedback";
import InvoiceModel from "@/models/Invoice";
import OwnerModel from "@/models/Owner";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function PUT(req) {
  await dbConnect();

  const { username, invoiceNumber } = await req.json();

  try {
    const owner = await OwnerModel.findOne({ username: username });

    if (!owner) {
      return NextResponse.json(
        { success: false, message: "Business not found" },
        { status: 404 }
      );
    }

    const invoice = await InvoiceModel.findOne({
      invoiceId: invoiceNumber,
      owner: owner._id,
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, message: "Invoice not found" },
        { status: 404 }
      );
    }

    if (invoice.isFeedbackSubmitted && invoice.updatedRecommendedActions) {
      return NextResponse.json(
        { success: false, message: "Recommended actions already updated" },
        { status: 400 }
      );
    }

    const feedbacks = await FeedbackModel.find({ givenTo: owner._id });
    const totalNumberOfFeedbacks = feedbacks.length;

    const metrics = {
      satisfactionRating: "Satisfaction",
      communicationRating: "Communication",
      qualityOfServiceRating: "Quality of Service",
      valueForMoneyRating: "Value for Money",
      recommendRating: "Recommendation",
      overAllRating: "Overall Rating",
    };

    const averageRatings = {};
    Object.keys(metrics).forEach((key) => {
      averageRatings[key] =
        totalNumberOfFeedbacks > 0
          ? feedbacks.reduce((sum, feedback) => sum + feedback[key], 0) /
            totalNumberOfFeedbacks
          : 0;
    });

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const ratingsPrompt = `
      Satisfaction: ${averageRatings.satisfactionRating}/5,
      Communication: ${averageRatings.communicationRating}/5,
      Quality of Service: ${averageRatings.qualityOfServiceRating}/5,
      Value for Money: ${averageRatings.valueForMoneyRating}/5,
      Recommendation: ${averageRatings.recommendRating}/5,
      Overall Rating: ${averageRatings.overAllRating}/5
    `;

    // Generate improvement suggestions
    const improvementsPrompt = `${ratingsPrompt}\n\nBased on these ratings, provide exactly 3 specific, actionable improvement points. Each point should be a single line without any special characters or formatting. Focus on areas with lower ratings. Keep each point concise and practical. Do not include any introduction, preamble, or additional text—just 3 specific points.`;
    const improvementsResult = await model.generateContent(improvementsPrompt);
    const improvements = improvementsResult.response
      .text()
      .split("\n")
      .filter((point) => point.trim())
      .map((point) => point.replace(/[*#\-•]/g, "").trim())
      .slice(0, 3);

    // Generate strengths
    const strengthsPrompt = `${ratingsPrompt}\n\nBased on these ratings, provide exactly 3 key strengths. Each point should be a single line without any special characters or formatting. Focus on areas with higher ratings. Keep each point concise and impactful. Do not include any introduction, preamble, or additional text—just 3 specific points.`;
    const strengthsResult = await model.generateContent(strengthsPrompt);
    const strengths = strengthsResult.response
      .text()
      .split("\n")
      .filter((point) => point.trim())
      .map((point) => point.replace(/[*#\-•]/g, "").trim())
      .slice(0, 3);

    owner.currentRecommendedActions = {
      improvements,
      strengths,
    };

    if (invoice.updatedRecommendedActions === false) {
      invoice.updatedRecommendedActions = true;
    }
    await invoice.save();
    await owner.save();

    // khatam
    return NextResponse.json(
      { success: true, message: "Recommended actions set successfully" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error setting recommended actions:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
