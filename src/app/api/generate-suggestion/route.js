import { GoogleGenerativeAI } from "@google/generative-ai";
import OwnerModel from "@/models/Owner";
import InvoiceModel from "@/models/Invoice";
import dbConnect from "@/lib/dbConnect";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST(req) {
  try {
    const body = await req.json();
    const { username, invoiceNumber } = body;

    // Connect to database
    await dbConnect();

    // Find the owner and check AI usage count
    const owner = await OwnerModel.findOne({
      username: username,
    });

    if (!owner) {
      return NextResponse.json(
        { success: false, message: "Business not found" },
        { status: 404 }
      );
    }

    const invoice = await InvoiceModel.findOne({
      invoiceId: invoiceNumber,
      owner: owner._id
    })

    if (!invoice) {
      return NextResponse.json(
        { success: false, message: "Invoice not found" },
        { status: 404 }
      );
    }

    if (invoice.AIuseCount >= 3) {
      return NextResponse.json(
        { success: false, message: "AI usage limit reached for this feedback" },
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
    if (
      body.feedbackContent &&
      body.feedbackContent.trim() !== "" &&
      body.suggestionContent &&
      body.suggestionContent.trim() !== ""
    ) {
      prompt += `
      
      User's Feedback: "${body.feedbackContent}"
      
      User's Suggestion: "${body.suggestionContent}"
      
      Based on these ratings, the user's feedback, and suggestion, generate a constructive 30-word suggestion for improvement. Focus on specific, actionable points that could enhance their experience. Keep the tone positive and solution-oriented. Set the character count of response in the range 100-200, not above 500. Give response as plain text, no text decoration, starting or ending quotation marks, or formatting.`;
    } else if (body.feedbackContent && body.feedbackContent.trim() !== "") {
      prompt += `
      
      User's Feedback: "${body.feedbackContent}"
      
      Based on these ratings and the user's feedback, generate a constructive 30-word suggestion for improvement. Focus on specific, actionable points that could enhance their experience. Keep the tone positive and solution-oriented. The character count of response in the range 100-200, strictly not above 500. Give response as plain text, no text decoration, starting or ending quotation marks, or formatting.`;
    } else if (body.suggestionContent && body.suggestionContent.trim() !== "") {
      prompt += `
      
      User's Suggestion: "${body.suggestionContent}"
      
      Based on these ratings and the user's suggestion, generate a constructive 20-word suggestion for improvement. Focus on specific, actionable points that could enhance their experience. Keep the tone positive and solution-oriented. The character count of response in the range 100-200, strictly not above 500. Give response as plain text, no text decoration, starting or ending quotation marks, or formatting.`;
    } else {
      prompt += `
      
      Based on these ratings, generate a constructive 20-word suggestion for improvement. Focus on the areas with lower ratings and provide specific, actionable advice. Keep the tone positive and solution-oriented. The character count of response in the range 100-200, strictly not above 500. Give response as plain text, no text decoration, starting or ending quotation marks, or formatting.`;
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });
    const result = await model.generateContent(prompt);

    const suggestion = result.response.text();

    // Update AI usage count
    invoice.AIuseCount += 1;
    await invoice.save();

    return NextResponse.json(
      {
        success: true,
        message: "Suggestion generated successfully",
        data: { suggestion },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error generating suggestion:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate suggestion" },
      { status: 500 }
    );
  }
}
