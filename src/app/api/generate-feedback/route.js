import { GoogleGenerativeAI } from "@google/generative-ai";
import InvoiceModel from "@/models/Invoice";
import dbConnect from "@/lib/dbConnect";
import { NextResponse } from "next/server";
import OwnerModel from "@/models/Owner";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST(req) {
  try {
    const body = await req.json();
    const { username, invoiceNumber } = body;

    // Connect to database
    await dbConnect();

    const owner = await OwnerModel.findOne({
      username: username,
    });

    if (!owner) {
      return NextResponse.json(
        { success: false, message: "Owner not found" },
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

    if (invoice.AIuseCount >= 3) {
      return NextResponse.json(
        { success: false, message: "AI usage limit reached for this invoice" },
        { status: 429 }
      );
    }

    let prompt = `
      Overall Satisfaction: ${body.satisfactionRating}/5,
      Communication: ${body.communicationRating}/5,
      Quality of Service: ${body.qualityOfServiceRating}/5,
      Value for Money: ${body.valueForMoneyRating}/5,
      Likelihood to Recommend: ${body.recommendRating}/5,
      Overall Rating: ${body.overAllRating}/5
    `;

    // Only add user's feedback to prompt if it exists and is not empty
    if (body.feedbackContent && body.feedbackContent.trim() !== "") {
      prompt += `
      
      User's Feedback: "${body.feedbackContent}"
      
      Based on these ratings and the user's feedback, write a personal 50-word feedback in first person ("I" perspective) that sounds natural and authentic. Include specific details from their feedback while maintaining their tone and sentiment. Make it sound like a real customer sharing their experience.  `;
    } else {
      prompt += `
      
      Write a personal 30-word feedback in first person ("I" perspective) based on these ratings. Make it sound natural and authentic, like a real customer sharing their experience. Include specific details about what they liked or what could be better.The character count of response in the range 100-200, strictly not above 500. Give response as plain text, no text decoration, starting or ending quotation marks, or formatting.`;
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });
    const result = await model.generateContent(prompt);
    const feedback = result.response.text();

    // Update AI usage count
    invoice.AIuseCount += 1;
    await invoice.save();

    return NextResponse.json(
      {
        success: true,
        message: "Feedback generated successfully",
        feedback: feedback,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error generating feedback:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate feedback" },
      { status: 500 }
    );
  }
}
