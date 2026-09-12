import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ This automatically verifies HMAC signature
    const { shop, session, topic } = await authenticate.webhook(request);

    console.log(`📨 Compliance webhook received: ${topic} from ${shop}`);
    
    // Parse the body
    const body = await request.json();
    console.log("📦 Payload:", JSON.stringify(body, null, 2));

    switch (topic) {
      case "customers/data_request":
        // 🟢 Customer requested their data
        console.log(`📤 Data request for customer: ${body.customer?.id}`);
        // TODO: Export customer data and send to merchant
        // await exportCustomerData(body.customer, body.shop_domain);
        break;

      case "customers/redact":
        // 🔴 Customer data deletion request
        console.log(`🔴 Redact request for customer: ${body.customer?.id}`);
        // TODO: Delete all customer data
        // await deleteCustomerData(body.customer.id, body.shop_domain);
        break;

      case "shop/redact":
        // 🔴 Shop data deletion request
        console.log(`🏪 Shop redact request for: ${body.shop_domain}`);
        // TODO: Delete all shop data
        // await deleteAllShopData(body.shop_domain);
        break;

      default:
        console.log(`⚠️ Unknown compliance topic: ${topic}`);
    }

    // ✅ Must return 200 OK for Shopify to acknowledge receipt
    return new Response("OK", { status: 200 });
    
  } catch (error) {
    console.error("❌ Webhook error:", error);
    
    // If HMAC verification fails, return 401 Unauthorized
    if (error instanceof Error && error.message.includes("HMAC")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    return new Response("Error processing webhook", { status: 500 });
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};