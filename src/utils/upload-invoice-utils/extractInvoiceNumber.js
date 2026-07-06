import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function extractInvoiceNumberFromPdf(file) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const bytes = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(bytes);

    const result = await model.generateContent([
      {
        inlineData: {
          data: pdfBuffer.toString("base64"),
          mimeType: "application/pdf",
        },
      },
      `Extract the following information from the invoice PDF:
      1. Invoice identifier (Invoice ID, Invoice No., Order ID, Customer ID, or Reference ID)
      2. Customer name
      3. Customer email
      4. Total amount (extract only the numeric value without any currency symbols, commas, or formatting)
      
      Return the information in JSON format with these exact keys:
      {
        "invoiceId": "extracted invoice identifier",
        "customerName": "extracted customer name",
        "customerEmail": "extracted customer email",
        "totalAmount": "extracted total amount as a pure number"
      }
      
      If any field cannot be found, use "Not Found" as the value.
      Return only the JSON object, no additional text or formatting.`,
    ]);

    const responseText = result.response.text().trim();
    
    // Clean up the response text by removing markdown code blocks and any extra whitespace
    const cleanedText = responseText
      .replace(/```json\s*|\s*```/g, '') // Remove markdown code blocks
      .replace(/^\s+|\s+$/g, ''); // Remove leading/trailing whitespace


    try {
      const extractedData = JSON.parse(cleanedText);
      
      // Clean up total amount to ensure it's a pure number
      if (extractedData.totalAmount && extractedData.totalAmount !== "Not Found") {
        // Remove any currency symbols, commas, and whitespace
        extractedData.totalAmount = extractedData.totalAmount
          .replace(/[^\d.-]/g, '') // Remove everything except digits, decimal point, and minus sign
          .replace(/^0+/, '') // Remove leading zeros
          .replace(/^\./, '0.') // Add leading zero if starts with decimal point
          .replace(/\.$/, '') // Remove trailing decimal point
          .replace(/\.(?=.*\.)/g, ''); // Remove all but last decimal point
        
        // If the result is empty or invalid, set to "Not Found"
        if (!extractedData.totalAmount || isNaN(extractedData.totalAmount)) {
          extractedData.totalAmount = "Not Found";
        }
      }
      
      return extractedData;
    } catch (error) {
      console.error("Failed to parse extracted data:", error);
      console.error("Raw response:", responseText);
      console.error("Cleaned text:", cleanedText);
      return {
        invoiceId: "Not Found",
        customerName: "Not Found",
        customerEmail: "Not Found",
        totalAmount: "Not Found"
      };
    }
  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      invoiceId: "Extraction Failed",
      customerName: "Extraction Failed",
      customerEmail: "Extraction Failed",
      totalAmount: "Extraction Failed"
    };
  }
}
