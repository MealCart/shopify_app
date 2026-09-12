import { useEffect, useState, useRef } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

// ===== LABEL SIZES =====
const LABEL_SIZES = [
  { id: "4-per-page", label: "A4 (4 labels)", description: "2 columns × 2 rows" },
  { id: "6-per-page", label: "A4 (6 labels)", description: "2 columns × 3 rows" },
  { id: "8-per-page-1", label: "A4 (9.7 x 6.77 cm)", description: "2 columns × 4 rows" },
  { id: "8-per-page-2", label: "A4 (10.5 x 7.4 cm)", description: "2 columns × 4 rows" },
  { id: "10x10", label: "10 x 10 cm", description: "Square labels" },
  { id: "10x15", label: "10 x 15 cm", description: "Rectangular labels" },
  { id: "7.6x5", label: "7.6 x 5 cm", description: "Small labels" },
];

const STORAGE_KEY = 'shopify_label_size';
const SENT_ORDERS_KEY = 'shopify_sent_orders';

// ===== LOADER =====
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(
      `#graphql
      query GetOrders($first: Int!) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              customer {
                firstName
                lastName
                email
                phone
              }
              shippingAddress {
                address1
                address2
                city
                province
                provinceCode
                zip
                country
                countryCode
                phone
                name
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      price
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { first: 50 } }
    );

    const responseJson = await response.json() as any;

    if (responseJson.errors) {
      return { orders: [], error: 'Failed to fetch orders: ' + JSON.stringify(responseJson.errors) };
    }

    const orders = responseJson.data?.orders?.edges?.map((edge: any) => edge.node) || [];
    return { orders };
  } catch (error) {
    return { orders: [], error: 'Failed to fetch orders: ' + (error as Error).message };
  }
};

// ===== MAIN COMPONENT =====
export default function OrdersIndex() {
  const loaderData = useLoaderData<typeof loader>() as { orders?: any[], error?: string };
  const shopify = useAppBridge();
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(false);

  // ===== AUTH STATE =====
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // ===== DELIVERY STATE =====
  const [deliveryDates, setDeliveryDates] = useState<{ [key: string]: string }>({});
  const [boxCounts, setBoxCounts] = useState<{ [key: string]: number }>({});
  const [sendingStatus, setSendingStatus] = useState<{ [key: string]: 'idle' | 'sending' | 'success' | 'error' }>({});
  const [sendMessages, setSendMessages] = useState<{ [key: string]: string }>({});

  // ===== CHECKBOX STATE =====
  const [selectedOrders, setSelectedOrders] = useState<{ [key: string]: boolean }>({});
  const [groupSelectAll, setGroupSelectAll] = useState<{ [key: string]: boolean }>({});
  const [batchSending, setBatchSending] = useState<{ [key: string]: boolean }>({});

  // ===== OTHER STATE =====
  const [selectedLabelSize, setSelectedLabelSize] = useState<string>("4-per-page");
  const [sentOrders, setSentOrders] = useState<{ [key: string]: { doNumber: string, date: string, boxes: number } }>({});
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [userPrefix, setUserPrefix] = useState<string>("DO");

  // ===== LOAD FROM LOCALSTORAGE ON MOUNT =====
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check if user is already logged in
      const token = localStorage.getItem("auth_token");
      const userData = localStorage.getItem("user");

      if (token && userData) {
        setIsLoggedIn(true);
        try {
          const parsedUser = JSON.parse(userData);
          setGroupId(parsedUser?.groupId || parsedUser?.group_id || null);
          setGroupName(parsedUser?.groupName || parsedUser?.group_name || null);
          setUserPrefix(parsedUser?.prefix || "DO");
        } catch (e) { console.error(e); }
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSelectedLabelSize(saved);

      const savedSentOrders = localStorage.getItem(SENT_ORDERS_KEY);
      if (savedSentOrders) {
        try { setSentOrders(JSON.parse(savedSentOrders)); } catch (e) { console.error(e); }
      }
    }
  }, []);

  // ===== HANDLE LOGIN =====
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    try {
      // ✅ Call your backend login API
      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // ✅ Store token and user data in localStorage
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));

        // ✅ Update state to show dashboard (NO redirect!)
        setGroupId(data.user?.groupId || data.user?.group_id || null);
        setGroupName(data.user?.groupName || data.user?.group_name || null);
        setUserPrefix(data.user?.prefix || "DO");
        setIsLoggedIn(true);
        setIsLoggingIn(false);

        shopify.toast.show("Login successful!");
      } else {
        setLoginError(data.error || "Invalid email or password");
        setIsLoggingIn(false);
      }
    } catch (error) {
      console.error("Login error:", error);
      setLoginError("Failed to connect to authentication server");
      setIsLoggingIn(false);
    }
  };

  // ===== HANDLE LOGOUT =====
  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("user");
    }
    setIsLoggedIn(false);
    setLoginEmail("");
    setLoginPassword("");
    shopify.toast.show("Logged out successfully");
  };

  // ===== LOAD ORDERS WHEN LOGGED IN =====
  useEffect(() => {
    if (hasLoaded.current || !isLoggedIn) return;
    hasLoaded.current = true;

    if (loaderData) {
      if (loaderData.error) {
        setError(loaderData.error);
      } else if (loaderData.orders) {
        setOrders(loaderData.orders);
      }
      setIsLoading(false);
    }
  }, [loaderData, isLoggedIn]);

  // Save sent orders
  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(sentOrders).length > 0) {
      localStorage.setItem(SENT_ORDERS_KEY, JSON.stringify(sentOrders));
    }
  }, [sentOrders]);

  // Save label size
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, selectedLabelSize);
    }
  }, [selectedLabelSize]);

  // Set default delivery dates
  useEffect(() => {
    if (!isLoggedIn) return;

    const getDefaultDate = () => {
      const now = new Date();
      const hour = now.getHours();
      const minutes = now.getMinutes();
      const isPastCutOff = hour > 16 || (hour === 16 && minutes > 0);
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + (isPastCutOff ? 2 : 1));
      return targetDate.toISOString().split('T')[0];
    };

    const defaultDate = getDefaultDate();
    const dates: { [key: string]: string } = {};
    const boxes: { [key: string]: number } = {};
    const selected: { [key: string]: boolean } = {};

    orders.forEach(order => {
      if (sentOrders[order.id]) {
        dates[order.id] = sentOrders[order.id].date;
        boxes[order.id] = sentOrders[order.id].boxes;
      } else {
        dates[order.id] = defaultDate;
        boxes[order.id] = 1;
      }
      selected[order.id] = false;
    });

    setDeliveryDates(dates);
    setBoxCounts(boxes);
    setSelectedOrders(selected);
  }, [orders, sentOrders, isLoggedIn]);

  // ===== HELPERS =====
  const updateDeliveryDate = (orderId: string, date: string) => {
    if (sentOrders[orderId]) {
      setSentOrders(prev => ({ ...prev, [orderId]: { ...prev[orderId], date } }));
    }
    setDeliveryDates(prev => ({ ...prev, [orderId]: date }));
  };

  const updateBoxCount = (orderId: string, count: number) => {
    if (sentOrders[orderId]) {
      setSentOrders(prev => ({ ...prev, [orderId]: { ...prev[orderId], boxes: Math.max(1, count) } }));
    }
    setBoxCounts(prev => ({ ...prev, [orderId]: Math.max(1, count) }));
  };

  const handleSelectOrder = (orderId: string, checked: boolean) => {
    setSelectedOrders(prev => ({ ...prev, [orderId]: checked }));
  };

  const handleSelectAll = (groupKey: string, checked: boolean, groupOrders: any[]) => {
    const newSelected = { ...selectedOrders };
    groupOrders.forEach(order => { newSelected[order.id] = checked; });
    setSelectedOrders(newSelected);
    setGroupSelectAll(prev => ({ ...prev, [groupKey]: checked }));
  };

  const areAllSelected = (groupOrders: any[]) => groupOrders.every(o => selectedOrders[o.id] === true);
  const areAnySelected = (groupOrders: any[]) => groupOrders.some(o => selectedOrders[o.id] === true);
  const getSelectedOrderIds = (groupOrders: any[]) => groupOrders.filter(o => selectedOrders[o.id] === true).map(o => o.id);
  const isOrderSent = (orderId: string) => !!sentOrders[orderId];
  const getSentOrderDetails = (orderId: string) => sentOrders[orderId] || null;
  const getLabelSizeLabel = (id: string) => LABEL_SIZES.find(s => s.id === id)?.label || id;

  // ===== GENERATE LABELS =====
  const generateAndDownloadLabels = async (
    doNumber: string, barcodes: string[], recipientName: string, address: string,
    company: string, phone: string, instructions: string,
    state: string, postcode: string, city: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("auth_token") : null;

      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/generate-and-download-labels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          doNumber, barcodes, customerName: recipientName, address,
          phone, instructions, companyName: company,
          layout: selectedLabelSize, state: state || '', postcode: postcode || '', city: city || ''
        }),
        mode: 'cors',
      });

      if (!response.ok) {
        if (response.status === 401) throw new Error('Session expired.');
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate labels');
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/pdf')) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `labels_${doNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        return { success: true };
      }

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      if (data.url || data.filename) {
        const filename = data.filename || `labels_${doNumber}.pdf`;
        const encodedFilename = encodeURIComponent(filename);
        let downloadUrl;
        if (data.url) {
          downloadUrl = data.url.startsWith('http') ? data.url : `https://dtrack-backend-0zzv.onrender.com${data.url}`;
        } else {
          downloadUrl = `https://dtrack-backend-0zzv.onrender.com/uploads/labels/${encodedFilename}`;
        }

        const fileResponse = await fetch(downloadUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
          mode: 'cors',
        });

        if (!fileResponse.ok) throw new Error('Failed to download file');
        const blob = await fileResponse.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
        return { success: true };
      }
      return { success: true };
    } catch (error) {
      console.error('Error generating labels:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed' };
    }
  };

  const autoDownloadLabels = async (order: any, doNumber: string, boxesCount: number) => {
    try {
      const barcodes = [];
      for (let i = 1; i <= boxesCount; i++) barcodes.push(`${doNumber}-${String(i).padStart(2, '0')}`);
      const firstName = order.customer?.firstName || '';
      const lastName = order.customer?.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
      const phone = order.customer?.phone || order.shippingAddress?.phone || '';
      const shipping = order.shippingAddress || {};
      const address1 = shipping.address1 || '';
      const address2 = shipping.address2 || '';
      const fullAddress = address2 ? `${address1}, ${address2}` : address1;

      const result = await generateAndDownloadLabels(
        doNumber, barcodes, fullName, fullAddress, '', phone, '',
        shipping.provinceCode || shipping.province || '', shipping.zip || '', shipping.city || ''
      );

      if (result.success) {
        shopify.toast.show(`✅ Labels downloaded for ${doNumber}`);
        return true;
      } else {
        shopify.toast.show(`⚠️ Labels not downloaded: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error('Auto-download error:', error);
      return false;
    }
  };

  const sendToMealCart = async (order: any) => {
    const orderId = order.id;

    // Guard: don't send if already sent
    if (isOrderSent(orderId)) {
      shopify.toast.show("This order has already been sent");
      return;
    }

    setSendingStatus(prev => ({ ...prev, [orderId]: 'sending' }));
    setSendMessages(prev => ({ ...prev, [orderId]: '' }));

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("auth_token") : null;

      const firstName = order.customer?.firstName || '';
      const lastName = order.customer?.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
      const email = order.customer?.email || '';
      const customerPhone = order.customer?.phone || order.shippingAddress?.phone || '';

      const shipping = order.shippingAddress || {};
      const address1 = shipping.address1 || '';
      const address2 = shipping.address2 || '';
      const fullAddress = address2 ? `${address1}, ${address2}` : address1;

      const lineItems = order.lineItems?.edges || [];
      const contents = lineItems.map((edge: any) => edge.node.title).join(', ');

      const deliveryDate = deliveryDates[orderId] || new Date().toISOString().split('T')[0];
      const boxesCount = boxCounts[orderId] || 1;
      const orderNumber = order.name?.replace('#', '') || '0000';
      const timestamp = Date.now().toString().slice(-6);
      const doNumber = `${userPrefix}-${orderNumber}-${timestamp}`;

      const barcodes = [];
      for (let i = 1; i <= boxesCount; i++) barcodes.push(`${doNumber}-${String(i).padStart(2, '0')}`);

      const jobData = {
        do_number: doNumber, date: deliveryDate, time_window: "07:00-18:00",
        address: fullAddress || address1 || "Address not provided",
        deliver_to: fullName, phone: customerPhone || shipping.phone || "Not provided",
        notify_email: email, instructions: "", group_id: groupId || "", group_name: groupName || "",
        delivery_type: "delivery", cartons: boxesCount, boxes: boxesCount, weight: 0,
        address_1: address1, address_2: address2, postal_code: shipping.zip || "",
        city: shipping.city || "", state: shipping.provinceCode || shipping.province || "",
        country: shipping.country || "Australia", company_name: "", customer_name: fullName,
        contents, barcodes,
      };

      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/create-job", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(jobData),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSentOrders(prev => ({
          ...prev,
          [orderId]: { doNumber, date: deliveryDate, boxes: boxesCount }
        }));

        setSendingStatus(prev => ({ ...prev, [orderId]: 'success' }));
        setSendMessages(prev => ({ ...prev, [orderId]: `✅ Created: ${doNumber}` }));
        shopify.toast.show(`✅ Delivery ${doNumber} created!`);

        await autoDownloadLabels(order, doNumber, boxesCount);

        setTimeout(() => {
          setSendingStatus(prev => ({ ...prev, [orderId]: 'idle' }));
          setSendMessages(prev => ({ ...prev, [orderId]: '' }));
        }, 5000);
      } else {
        throw new Error(data.error || 'Failed to create job');
      }
    } catch (error) {
      console.error('Error sending to MealCart:', error);
      setSendingStatus(prev => ({ ...prev, [orderId]: 'error' }));
      setSendMessages(prev => ({ ...prev, [orderId]: `❌ ${(error as Error).message}` }));
      shopify.toast.show(`❌ Failed: ${(error as Error).message}`);
      setTimeout(() => {
        setSendingStatus(prev => ({ ...prev, [orderId]: 'idle' }));
        setSendMessages(prev => ({ ...prev, [orderId]: '' }));
      }, 5000);
    }
  };

  const sendBatchToMealCart = async (groupKey: string, groupOrders: any[]) => {
    // Exclude orders that were already sent
    const selectedOrderIds = getSelectedOrderIds(groupOrders).filter(id => !isOrderSent(id));
    if (selectedOrderIds.length === 0) {
      shopify.toast.show("No unsent orders selected");
      return;
    }

    setBatchSending(prev => ({ ...prev, [groupKey]: true }));
    let successCount = 0, failCount = 0;

    for (const orderId of selectedOrderIds) {
      const order = groupOrders.find(o => o.id === orderId);
      if (!order) continue;
      try {
        await sendToMealCart(order);
        successCount++;
        await new Promise(r => setTimeout(r, 500));
      } catch { failCount++; }
    }

    setBatchSending(prev => ({ ...prev, [groupKey]: false }));
    shopify.toast.show(successCount > 0 ? `✅ Sent ${successCount} orders` : `❌ All failed`);

    const newSelected = { ...selectedOrders };
    groupOrders.forEach(o => { newSelected[o.id] = false; });
    setSelectedOrders(newSelected);
    setGroupSelectAll(prev => ({ ...prev, [groupKey]: false }));
  };

  const formatDateForGrouping = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const isToday = (d: string) => new Date(d).toDateString() === new Date().toDateString();
  const isYesterday = (d: string) => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return new Date(d).toDateString() === y.toDateString();
  };
  const getDateGroupName = (d: string) => isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : formatDateForGrouping(d);

  const groupOrdersByDate = (orders: any[]) => {
    const groups: { [key: string]: any[] } = {};
    orders.forEach(order => {
      const key = new Date(order.createdAt).toDateString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(order);
    });
    return Object.keys(groups)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      .map(key => ({ date: key, orders: groups[key] }));
  };

  const groupedOrders = groupOrdersByDate(orders);

  // ===== LOGIN PAGE (renders inside Shopify iframe) =====
  if (!isLoggedIn) {
    return (
      <div style={{
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f6f7f8",
        padding: "20px",
        boxSizing: "border-box"
      }}>
        <div style={{
          width: "100%",
          maxWidth: "400px",
          backgroundColor: "#ffffff",
          borderRadius: "8px",
          padding: "40px 32px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔐</div>
            <h2 style={{ margin: "0 0 8px 0", color: "#202223", fontSize: "24px" }}>
              MealCart Login
            </h2>
            <p style={{ margin: "0", color: "#6d7175", fontSize: "14px" }}>
              Sign in to your MealCart account
            </p>
          </div>

          {loginError && (
            <div style={{
              padding: "12px",
              backgroundColor: "#fde7e7",
              borderRadius: "4px",
              marginBottom: "16px",
              color: "#bf0711",
              fontSize: "14px"
            }}>
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "500", fontSize: "14px", color: "#202223" }}>
                Email
              </label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                placeholder="you@example.com"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d2d4",
                  borderRadius: "4px",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "500", fontSize: "14px", color: "#202223" }}>
                Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                placeholder="••••••••"
                minLength={6}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d2d4",
                  borderRadius: "4px",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: isLoggingIn ? "#6d7175" : "#006e52",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "16px",
                fontWeight: "600",
                cursor: isLoggingIn ? "not-allowed" : "pointer"
              }}
            >
              {isLoggingIn ? "Logging in..." : "Login"}
            </button>
          </form>

          <div style={{ marginTop: "24px", textAlign: "center", fontSize: "13px", color: "#6d7175" }}>
            Contact your administrator if you need an account
          </div>
        </div>
      </div>
    );
  }

  // ===== LOADING STATE =====
  if (isLoading) {
    return (
      <div style={{ width: "100%", padding: "60px 20px", textAlign: "center" }}>
        <div style={{ width: "40px", height: "40px", border: "4px solid #e1e3e5", borderTop: "4px solid #006e52", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <h3 style={{ margin: "0 0 8px 0" }}>Loading your orders...</h3>
      </div>
    );
  }

  // ===== ORDERS DASHBOARD =====
  return (
    <div style={{ width: "100%", maxWidth: "100%", padding: 0, margin: 0, overflowX: "hidden" }}>
      {/* Header */}
      <div style={{ width: "100%", backgroundColor: "#ffffff", borderBottom: "1px solid #e1e3e5", padding: "16px 24px", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "600", color: "#202223", fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
          📦 Shopify Orders
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#6d7175" }}>Labels:</span>
            <select value={selectedLabelSize} onChange={(e) => setSelectedLabelSize(e.target.value)} style={{ padding: "5px 10px", border: "1px solid #d1d2d4", borderRadius: "4px", fontSize: "12px", backgroundColor: "#ffffff", cursor: "pointer" }}>
              {LABEL_SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: "8px 20px",
              backgroundColor: "#bf0711",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500"
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ width: "100%", padding: "20px 24px", boxSizing: "border-box" }}>
        <div style={{ width: "100%", backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e1e3e5", padding: "20px 24px", boxSizing: "border-box" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600", color: "#202223" }}>Recent Orders</h3>

          {error && (
            <div style={{ padding: "12px", backgroundColor: "#fde7e7", borderRadius: "4px", marginBottom: "16px", color: "#bf0711" }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {orders.length === 0 && !error ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>📦</div>
              <h3 style={{ margin: "0 0 8px 0" }}>No orders yet</h3>
              <p style={{ margin: 0, color: "#6d7175" }}>Check back later!</p>
            </div>
          ) : orders.length > 0 ? (
            <div style={{ width: "100%" }}>
              {groupedOrders.map((group) => {
                const groupKey = group.date;
                const allSelected = areAllSelected(group.orders);
                const anySelected = areAnySelected(group.orders);
                const selectedCount = getSelectedOrderIds(group.orders).filter(id => !isOrderSent(id)).length;
                const isBatchSending = batchSending[groupKey] || false;

                return (
                  <div key={groupKey} style={{ marginBottom: "32px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid #e1e3e5", paddingBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <input type="checkbox" checked={allSelected} onChange={(e) => handleSelectAll(groupKey, e.target.checked, group.orders)} style={{ width: "16px", height: "16px", cursor: "pointer" }} />
                        <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#202223" }}>
                          {getDateGroupName(groupKey)}
                          <span style={{ fontSize: "13px", fontWeight: "400", color: "#6d7175", marginLeft: "8px" }}>
                            ({group.orders.length} order{group.orders.length > 1 ? 's' : ''})
                          </span>
                          {selectedCount > 0 && <span style={{ fontSize: "12px", color: "#b98900", marginLeft: "8px" }}>• {selectedCount} selected</span>}
                        </h4>
                      </div>
                      {selectedCount > 0 && (
                        <button onClick={() => sendBatchToMealCart(groupKey, group.orders)} disabled={isBatchSending} style={{ padding: "6px 16px", backgroundColor: isBatchSending ? "#6d7175" : "#006e52", color: "white", border: "none", borderRadius: "4px", cursor: isBatchSending ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: "500" }}>
                          {isBatchSending ? `⏳ Sending ${selectedCount}...` : `📤 Send Selected (${selectedCount})`}
                        </button>
                      )}
                    </div>

                    <div style={{ overflowX: "auto", width: "100%" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", minWidth: "1200px" }}>
                        <thead>
                          <tr>
                            {['Select', 'Order', 'Customer', 'Email', 'Phone', 'Address', 'Items', 'Total', 'Delivery Date', 'Boxes', 'Action'].map(h => (
                              <th key={h} style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5", fontWeight: "600", fontSize: "11px", color: "#6d7175", whiteSpace: "nowrap", width: h === 'Select' ? "40px" : "auto" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.orders.map((order: any, index: number) => {
                            const orderId = order.id;
                            const isSending = sendingStatus[orderId] === 'sending';
                            const isSuccess = sendingStatus[orderId] === 'success';
                            const isError = sendingStatus[orderId] === 'error';
                            const message = sendMessages[orderId] || '';
                            const sent = isOrderSent(orderId);
                            const sentDetails = getSentOrderDetails(orderId);

                            const fullName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || 'Guest';
                            const shipping = order.shippingAddress || {};
                            const fullAddress = [shipping.address1, shipping.address2, shipping.city, shipping.provinceCode, shipping.zip].filter(Boolean).join(', ') || 'N/A';
                            const itemCount = order.lineItems?.edges?.length || 0;

                            return (
                              <tr key={orderId || index}>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5" }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedOrders[orderId] || false}
                                    onChange={(e) => handleSelectOrder(orderId, e.target.checked)}
                                    disabled={sent || isSending}
                                    style={{ width: "15px", height: "15px" }}
                                    title={sent ? "This order has already been sent" : ""}
                                  />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5" }}>
                                  <a href={`https://admin.shopify.com/apps/orders/${orderId?.split('/').pop()}`} target="_blank" rel="noopener noreferrer" style={{ color: "#006e52", textDecoration: "none", fontWeight: "600" }}>
                                    {order.name}
                                  </a>
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5" }}>{fullName}</td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5", fontSize: "12px" }}>{order.customer?.email || 'N/A'}</td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5", fontSize: "12px" }}>{order.customer?.phone || shipping.phone || 'N/A'}</td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5", fontSize: "12px", maxWidth: "200px" }}>
                                  <div style={{ wordBreak: "break-word" }}>{fullAddress}</div>
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5", fontSize: "12px" }}>{itemCount} items</td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5", fontWeight: "600" }}>
                                  {order.totalPriceSet?.shopMoney?.amount || '0.00'} {order.totalPriceSet?.shopMoney?.currencyCode || 'USD'}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5" }}>
                                  <input
                                    type="date"
                                    value={deliveryDates[orderId] || ''}
                                    onChange={(e) => updateDeliveryDate(orderId, e.target.value)}
                                    style={{ padding: "5px 6px", border: "1px solid #d1d2d4", borderRadius: "4px", fontSize: "12px", width: "130px" }}
                                    disabled={sent || isSending}
                                  />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5" }}>
                                  <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={boxCounts[orderId] || 1}
                                    onChange={(e) => updateBoxCount(orderId, parseInt(e.target.value) || 1)}
                                    style={{ padding: "5px 6px", border: "1px solid #d1d2d4", borderRadius: "4px", fontSize: "12px", width: "55px" }}
                                    disabled={sent || isSending}
                                  />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: "1px solid #e1e3e5" }}>
                                  {sent ? (
                                    // Already sent — locked, no resend option
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <span style={{
                                        display: "inline-block",
                                        padding: "5px 12px",
                                        backgroundColor: "#e3f1df",
                                        color: "#006e52",
                                        border: "1px solid #006e52",
                                        borderRadius: "4px",
                                        fontSize: "12px",
                                        fontWeight: "600",
                                        whiteSpace: "nowrap",
                                        textAlign: "center"
                                      }}>
                                        ✅ Sent
                                      </span>
                                      <div style={{ fontSize: "9px", color: "#6d7175", textAlign: "center" }}>
                                        DO: {sentDetails?.doNumber || "N/A"}
                                      </div>
                                      <div style={{ fontSize: "9px", color: "#6d7175", textAlign: "center" }}>
                                        {sentDetails?.date} • {sentDetails?.boxes} box{sentDetails?.boxes > 1 ? "es" : ""}
                                      </div>
                                    </div>
                                  ) : (
                                    // Not sent yet — show send button
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <button
                                        onClick={() => sendToMealCart(order)}
                                        disabled={isSending}
                                        style={{
                                          padding: "5px 12px",
                                          backgroundColor: isError ? "#bf0711" : "#006e52",
                                          color: "white",
                                          border: "none",
                                          borderRadius: "4px",
                                          cursor: isSending ? "not-allowed" : "pointer",
                                          fontSize: "12px",
                                          fontWeight: "500",
                                          whiteSpace: "nowrap"
                                        }}
                                      >
                                        {isSending ? "⏳ Sending..." : isError ? "⚠️ Retry" : "📤 Send"}
                                      </button>
                                      {message && (
                                        <div style={{
                                          fontSize: "10px",
                                          color: isError ? "#bf0711" : "#6d7175",
                                          textAlign: "center"
                                        }}>
                                          {message}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};