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

// ===== THEME COLORS =====
const THEME = {
  primary: "#2d9cdb",
  primaryDark: "#1e88c7",
  primaryLight: "#e8f4f8",
  primaryLighter: "#d4e9f2",
  primaryBorder: "#c9d9e3",
  textDark: "#1a1a2e",
  textMuted: "#6b7c8c",
  textLight: "#8a9ba8",
  danger: "#bf0711",
  dangerLight: "#fde7e7",
  dangerBorder: "#f5c2c7",
  warning: "#b98900",
  warningLight: "#fef3e4",
  success: "#006e52",
  successLight: "#e4f5e8",
  white: "#ffffff",
  border: "#e1e3e5",
};

// ===== DAY MAP =====
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ===== CUT-OFF TIME CONFIG =====
const CUT_OFF_HOUR = 16;
const CUT_OFF_MINUTE = 0;

// ===== SERVER TIME CACHE =====
let serverTimeCache: Date | null = null;
let serverTimeFetchPromise: Promise<Date> | null = null;

// ===== GET SERVER TIME =====
const getServerTimeSecure = async (): Promise<Date> => {
  if (serverTimeCache) {
    const age = Date.now() - serverTimeCache.getTime();
    if (age < 5000) return serverTimeCache;
  }
  if (serverTimeFetchPromise) return serverTimeFetchPromise;

  serverTimeFetchPromise = fetch("https://dtrack-backend-0zzv.onrender.com/api/time/server-time", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    mode: "cors",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Failed to fetch server time: ${response.status}`);
      const data = await response.json();
      const time = new Date(data.time);
      serverTimeCache = time;
      serverTimeFetchPromise = null;
      return time;
    })
    .catch((error) => {
      serverTimeFetchPromise = null;
      console.error('❌ Failed to fetch server time, using device time:', error);
      return new Date();
    });

  return serverTimeFetchPromise;
};

const getAustralianTime = async () => {
  const serverTime = await getServerTimeSecure();
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = formatter.formatToParts(serverTime);
  let day = '', month = '', year = '', hour = '', minute = '';
  parts.forEach(part => {
    if (part.type === 'day') day = part.value;
    if (part.type === 'month') month = part.value;
    if (part.type === 'year') year = part.value;
    if (part.type === 'hour') hour = part.value;
    if (part.type === 'minute') minute = part.value;
  });
  const ausDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
  return {
    date: ausDate,
    hour: parseInt(hour),
    minutes: parseInt(minute),
    dateStr: `${year}-${month}-${day}`
  };
};

const isPastCutOff = (hour: number, minutes: number): boolean => {
  return hour > CUT_OFF_HOUR || (hour === CUT_OFF_HOUR && minutes > CUT_OFF_MINUTE);
};

const getMinAllowedDate = async (): Promise<string> => {
  const aus = await getAustralianTime();
  const daysToAdd = isPastCutOff(aus.hour, aus.minutes) ? 2 : 1;
  const targetDate = new Date(aus.date);
  targetDate.setUTCDate(targetDate.getUTCDate() + daysToAdd);
  return targetDate.toISOString().split('T')[0];
};

const getDateInfo = async () => {
  const aus = await getAustralianTime();
  const today = new Date(aus.date);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 2);
  const pastCutOff = isPastCutOff(aus.hour, aus.minutes);
  return {
    today: today.toISOString().split('T')[0],
    tomorrow: tomorrow.toISOString().split('T')[0],
    dayAfterTomorrow: dayAfterTomorrow.toISOString().split('T')[0],
    isPastCutOff: pastCutOff,
    tomorrowObj: tomorrow,
    dayAfterTomorrowObj: dayAfterTomorrow,
    currentHour: aus.hour,
    currentMinutes: aus.minutes,
  };
};

const isDateAllowed = async (dateStr: string): Promise<{ allowed: boolean; reason?: string }> => {
  const info = await getDateInfo();
  if (dateStr === info.today) return { allowed: true };
  if (dateStr === info.tomorrow) {
    if (!info.isPastCutOff) return { allowed: true };
    const formattedDate = info.dayAfterTomorrowObj.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
    return {
      allowed: false,
      reason: `Tomorrow is not available because it's past 4 PM (AEST time). Please select ${formattedDate} or later.`
    };
  }
  return { allowed: true };
};

const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Sydney',
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  } catch (e) { return dateStr; }
};

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
              totalPriceSet { shopMoney { amount currencyCode } }
              customer { firstName lastName email phone }
              shippingAddress {
                address1 address2 city province provinceCode zip country countryCode phone name
              }
              lineItems(first: 10) {
                edges { node { title quantity variant { price } } }
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

  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Cut-off time
  const [loadingTime, setLoadingTime] = useState(true);
  const [minAllowedDate, setMinAllowedDate] = useState<string>("");
  const [cutOffMessage, setCutOffMessage] = useState<string | null>(null);
  const [isPastCutOff, setIsPastCutOff] = useState(false);
  const [dateInfo, setDateInfo] = useState({ isPastCutOff: false, tomorrow: "" });

  // Delivery
  const [deliveryDates, setDeliveryDates] = useState<{ [key: string]: string }>({});
  const [boxCounts, setBoxCounts] = useState<{ [key: string]: number }>({});
  const [sendingStatus, setSendingStatus] = useState<{ [key: string]: 'idle' | 'sending' | 'success' | 'error' }>({});
  const [sendMessages, setSendMessages] = useState<{ [key: string]: string }>({});

  // Edited address
  const [editedAddresses, setEditedAddresses] = useState<{
    [orderId: string]: {
      name: string; phone: string; address1: string; address2: string;
      city: string; provinceCode: string; zip: string; country: string;
    }
  }>({});
  const [editingOrder, setEditingOrder] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', phone: '', address1: '', address2: '', city: '',
    provinceCode: '', zip: '', country: 'Australia',
  });
  const [editSaving, setEditSaving] = useState(false);

  // Postcode validation
  const [postcodeValidation, setPostcodeValidation] = useState<{
    [orderId: string]: {
      status: 'idle' | 'checking' | 'valid' | 'invalid' | 'no-postcode';
      suburb?: string; postCode?: string; run?: string; message?: string;
      selectedDay?: string; nextAvailableDay?: string; nextAvailableDate?: string; days?: any;
    }
  }>({});

  // Checkbox
  const [selectedOrders, setSelectedOrders] = useState<{ [key: string]: boolean }>({});
  const [groupSelectAll, setGroupSelectAll] = useState<{ [key: string]: boolean }>({});
  const [batchSending, setBatchSending] = useState<{ [key: string]: boolean }>({});

  // Other
  const [selectedLabelSize, setSelectedLabelSize] = useState<string>("4-per-page");
  const [sentOrders, setSentOrders] = useState<{ [key: string]: { doNumber: string, date: string, boxes: number } }>({});
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [userPrefix, setUserPrefix] = useState<string>("DO");

  // ===== BULK LABELS MODAL STATE =====
  const [showBulkLabelsModal, setShowBulkLabelsModal] = useState(false);
  const [bulkLabelsLayout, setBulkLabelsLayout] = useState<string>("4-per-page");
  const [bulkLabelsGenerating, setBulkLabelsGenerating] = useState(false);
  const [bulkLabelsProgress, setBulkLabelsProgress] = useState(0);
  const [bulkLabelsError, setBulkLabelsError] = useState<string | null>(null);
  const [bulkLabelsCurrentJob, setBulkLabelsCurrentJob] = useState(0);
  const [bulkLabelsBookings, setBulkLabelsBookings] = useState<any[]>([]);

  // ===== GET EFFECTIVE ADDRESS =====
  const getEffectiveAddress = (order: any) => {
    const edited = editedAddresses[order.id];
    if (edited) return edited;
    const s = order.shippingAddress || {};
    return {
      name: s.name || `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || '',
      phone: s.phone || order.customer?.phone || '',
      address1: s.address1 || '',
      address2: s.address2 || '',
      city: s.city || '',
      provinceCode: s.provinceCode || s.province || '',
      zip: s.zip || '',
      country: s.country || 'Australia',
    };
  };

  // ===== OPEN EDIT MODAL =====
  const openEditModal = (order: any) => {
    const addr = getEffectiveAddress(order);
    setEditingOrder(order);
    setEditForm({
      name: addr.name, phone: addr.phone, address1: addr.address1,
      address2: addr.address2, city: addr.city,
      provinceCode: addr.provinceCode, zip: addr.zip, country: addr.country,
    });
  };

  // ===== SAVE EDITED ADDRESS =====
  const saveEditedAddress = () => {
    if (!editingOrder) return;
    setEditSaving(true);
    setEditedAddresses(prev => ({
      ...prev,
      [editingOrder.id]: { ...editForm }
    }));
    setPostcodeValidation(prev => {
      const next = { ...prev };
      delete next[editingOrder.id];
      return next;
    });
    shopify.toast.show("Address updated");
    setEditingOrder(null);
    setEditSaving(false);
  };

  const cancelEdit = () => setEditingOrder(null);

  // ===== INITIALIZE CUT-OFF TIME =====
  useEffect(() => {
    const initializeDates = async () => {
      setLoadingTime(true);
      try {
        const info = await getDateInfo();
        const minDate = await getMinAllowedDate();
        setMinAllowedDate(minDate);
        setDateInfo({ isPastCutOff: info.isPastCutOff, tomorrow: info.tomorrow });
        if (info.isPastCutOff) {
          setIsPastCutOff(true);
          setCutOffMessage(`⏰ It's past 4 PM (AEST time). The earliest available date is ${formatDateDisplay(info.dayAfterTomorrow)} (day after tomorrow).`);
        } else {
          setIsPastCutOff(false);
          setCutOffMessage(`📅 Tomorrow (${formatDateDisplay(info.tomorrow)}) is available. Book before 4 PM (AEST time) for next-day delivery.`);
        }
      } catch (error) {
        console.error('❌ Failed to initialize dates:', error);
        setMinAllowedDate(new Date().toISOString().split('T')[0]);
        setCutOffMessage('⚠️ Using device time. Please check your system clock.');
      } finally {
        setLoadingTime(false);
      }
    };
    initializeDates();
  }, []);

  // ===== LOAD LOCALSTORAGE =====
  useEffect(() => {
    if (typeof window !== 'undefined') {
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
      const savedEditedAddresses = localStorage.getItem('shopify_edited_addresses');
      if (savedEditedAddresses) {
        try { setEditedAddresses(JSON.parse(savedEditedAddresses)); } catch (e) { console.error(e); }
      }
    }
  }, []);

  // Persist data
  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(sentOrders).length > 0) {
      localStorage.setItem(SENT_ORDERS_KEY, JSON.stringify(sentOrders));
    }
  }, [sentOrders]);

  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(editedAddresses).length > 0) {
      localStorage.setItem('shopify_edited_addresses', JSON.stringify(editedAddresses));
    }
  }, [editedAddresses]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, selectedLabelSize);
    }
  }, [selectedLabelSize]);

  // ===== HANDLE LOGIN =====
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
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
      setLoginError("Failed to connect to authentication server");
      setIsLoggingIn(false);
    }
  };

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

  // Load orders
  useEffect(() => {
    if (hasLoaded.current || !isLoggedIn) return;
    hasLoaded.current = true;
    if (loaderData) {
      if (loaderData.error) setError(loaderData.error);
      else if (loaderData.orders) setOrders(loaderData.orders);
      setIsLoading(false);
    }
  }, [loaderData, isLoggedIn]);

  // Set default delivery dates
  useEffect(() => {
    if (!isLoggedIn || loadingTime) return;
    const defaultDate = minAllowedDate || new Date().toISOString().split('T')[0];
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
  }, [orders, sentOrders, isLoggedIn, loadingTime, minAllowedDate]);

  // ===== POSTCODE VALIDATION =====
  const validatePostcodeForOrder = async (orderId: string, postcode: string, dateStr: string) => {
    if (!postcode || !postcode.trim() || !dateStr) {
      setPostcodeValidation(prev => ({
        ...prev,
        [orderId]: { status: 'no-postcode', message: 'Missing postcode or date' }
      }));
      return;
    }
    setPostcodeValidation(prev => ({
      ...prev,
      [orderId]: { status: 'checking', postCode: postcode }
    }));
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/validate-postcode", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          postCode: postcode.trim(),
          postcode: postcode.trim(),
          post_code: postcode.trim(),
          date: dateStr,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPostcodeValidation(prev => ({
          ...prev,
          [orderId]: { status: 'invalid', message: data.error || `Postcode ${postcode} is not deliverable`, postCode: postcode }
        }));
        return;
      }
      const schedule = data.data?.schedule || {};
      const days = data.data?.days || schedule;
      const suburb = schedule.suburb_town || '';
      const run = schedule.run || '';
      const dateObj = new Date(dateStr + 'T00:00:00');
      const dayIndex = dateObj.getDay();
      const dayKey = DAY_KEYS[dayIndex];
      const dayName = DAY_NAMES[dayIndex];
      const isDeliverable = days[dayKey] === true;

      if (isDeliverable) {
        setPostcodeValidation(prev => ({
          ...prev,
          [orderId]: { status: 'valid', postCode: postcode, suburb, run, selectedDay: dayName, message: `Deliverable on ${dayName}`, days }
        }));
      } else {
        let nextAvailableDay: string | undefined;
        let nextAvailableDate: string | undefined;
        for (let i = 1; i <= 7; i++) {
          const nextDate = new Date(dateObj);
          nextDate.setDate(nextDate.getDate() + i);
          const nextDayIndex = nextDate.getDay();
          const nextDayKey = DAY_KEYS[nextDayIndex];
          if (days[nextDayKey] === true) {
            nextAvailableDay = DAY_NAMES[nextDayIndex];
            nextAvailableDate = nextDate.toISOString().split('T')[0];
            break;
          }
        }
        setPostcodeValidation(prev => ({
          ...prev,
          [orderId]: {
            status: 'invalid', postCode: postcode, suburb, run, selectedDay: dayName,
            message: `No delivery to ${postcode}${suburb ? ` (${suburb})` : ''} on ${dayName}`,
            nextAvailableDay, nextAvailableDate, days
          }
        }));
      }
    } catch (error) {
      console.error('Postcode validation error:', error);
      setPostcodeValidation(prev => ({
        ...prev,
        [orderId]: { status: 'invalid', message: 'Failed to validate postcode', postCode: postcode }
      }));
    }
  };

  // Auto-validate (skip sent orders)
  useEffect(() => {
    if (!isLoggedIn || orders.length === 0 || loadingTime) return;
    const timers: NodeJS.Timeout[] = [];
    orders.forEach(order => {
      if (sentOrders[order.id]) return;
      const addr = getEffectiveAddress(order);
      const postcode = (addr.zip || '').trim();
      const date = deliveryDates[order.id];
      if (postcode && date) {
        const timer = setTimeout(() => validatePostcodeForOrder(order.id, postcode, date), 500);
        timers.push(timer);
      } else if (!postcode) {
        setPostcodeValidation(prev => ({
          ...prev,
          [order.id]: { status: 'no-postcode', message: 'No postcode in order' }
        }));
      }
    });
    return () => { timers.forEach(t => clearTimeout(t)); };
  }, [orders, deliveryDates, isLoggedIn, sentOrders, editedAddresses, loadingTime]);

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

  // ===== GENERATE SINGLE LABELS (existing) =====
  const generateAndDownloadLabels = async (
    doNumber: string, barcodes: string[], recipientName: string, address: string,
    company: string, phone: string, instructions: string,
    state: string, postcode: string, city: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("auth_token") : null;
      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/generate-and-download-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
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
      const addr = getEffectiveAddress(order);
      const result = await generateAndDownloadLabels(
        doNumber, barcodes, addr.name,
        addr.address2 ? `${addr.address1}, ${addr.address2}` : addr.address1,
        '', addr.phone, '', addr.provinceCode, addr.zip, addr.city
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

  // ===== GENERATE COMBINED LABELS (NEW) =====
  const generateCombinedLabels = async (jobs: any[], layout: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("auth_token") : null;
      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/generate-combined-labels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ jobs, layout }),
        mode: 'cors',
      });

      if (!response.ok) {
        if (response.status === 401) throw new Error('Session expired.');
        let errorMsg = `Failed to generate combined labels (${response.status})`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorData.message || errorMsg;
        } catch (e) { /* ignore */ }
        throw new Error(errorMsg);
      }

      // Response is expected to be a PDF blob
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/pdf')) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Combined_Labels_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        return { success: true };
      }

      // If not PDF, try JSON (some backends return a URL)
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      if (data.url || data.filename) {
        const filename = data.filename || `Combined_Labels_${new Date().toISOString().split('T')[0]}.pdf`;
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
        if (!fileResponse.ok) throw new Error('Failed to download combined labels');
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
      console.error('Error generating combined labels:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to generate combined labels' };
    }
  };

  // ===== BUILD JOBS PAYLOAD FOR COMBINED LABELS =====
  const buildBulkJobsPayload = (selectedOrderList: any[]) => {
    return selectedOrderList.map(order => {
      const orderId = order.id;
      const sentDetails = sentOrders[orderId];
      const boxesCount = boxCounts[orderId] || sentDetails?.boxes || 1;
      const addr = getEffectiveAddress(order);

      let barcodes = [];
      if (sentDetails?.doNumber) {
        for (let i = 1; i <= boxesCount; i++) {
          barcodes.push(`${sentDetails.doNumber}-${String(i).padStart(2, '0')}`);
        }
      }

      return {
        doNumber: sentDetails?.doNumber || '',
        barcodes,
        customerName: addr.name || '',
        address: addr.address2 ? `${addr.address1}, ${addr.address2}` : addr.address1,
        companyName: '',
        phone: addr.phone || '',
        instructions: '',
        state: addr.provinceCode || '',
        postcode: addr.zip || '',
        city: addr.city || '',
      };
    }).filter(j => j.doNumber && j.barcodes.length > 0);
  };

  // ===== OPEN BULK LABELS MODAL =====
  const openBulkLabelsModal = (groupKey: string, groupOrders: any[]) => {
    // Only use orders that were ALREADY SENT (have DO numbers)
    const selectedSentOrders = groupOrders.filter(o => selectedOrders[o.id] && sentOrders[o.id]);

    if (selectedSentOrders.length === 0) {
      shopify.toast.show("Please select at least one SENT order to print labels");
      return;
    }

    setBulkLabelsBookings(selectedSentOrders);
    setBulkLabelsLayout(selectedLabelSize || "4-per-page");
    setBulkLabelsProgress(0);
    setBulkLabelsCurrentJob(0);
    setBulkLabelsError(null);
    setBulkLabelsGenerating(false);
    setShowBulkLabelsModal(true);
  };

  // ===== HANDLE BULK LABEL GENERATION =====
  const handleGenerateBulkLabels = async () => {
    if (bulkLabelsBookings.length === 0) {
      setBulkLabelsError("No orders selected");
      return;
    }

    setBulkLabelsGenerating(true);
    setBulkLabelsProgress(0);
    setBulkLabelsCurrentJob(0);
    setBulkLabelsError(null);

    const jobs = buildBulkJobsPayload(bulkLabelsBookings);
    const validJobs = jobs.filter(j => j.barcodes && j.barcodes.length > 0);

    if (validJobs.length === 0) {
      setBulkLabelsError("No valid jobs with DO numbers found");
      setBulkLabelsGenerating(false);
      return;
    }

    const total = validJobs.length;
    const progressInterval = window.setInterval(() => {
      setBulkLabelsCurrentJob(prev => (prev >= total ? prev : prev + 1));
      setBulkLabelsProgress(prev => (prev >= 95 ? prev : prev + Math.max(1, Math.floor(100 / total))));
    }, 250);

    try {
      const result = await generateCombinedLabels(validJobs, bulkLabelsLayout);
      window.clearInterval(progressInterval);
      setBulkLabelsCurrentJob(total);
      setBulkLabelsProgress(100);

      if (!result.success) {
        throw new Error(result.error || "Failed to generate combined labels");
      }

      shopify.toast.show(`✅ Combined PDF downloaded (${validJobs.length} jobs)`);

      setTimeout(() => {
        setShowBulkLabelsModal(false);
      }, 1000);

    } catch (err) {
      window.clearInterval(progressInterval);
      console.error("Error generating combined labels:", err);
      setBulkLabelsError(
        err instanceof Error ? err.message : "Failed to generate labels. Please try again."
      );
    } finally {
      setBulkLabelsGenerating(false);
    }
  };

  // ===== SEND TO MEALCART =====
  const sendToMealCart = async (order: any) => {
    const orderId = order.id;
    if (isOrderSent(orderId)) {
      shopify.toast.show("This order has already been sent");
      return;
    }

    const deliveryDate = deliveryDates[orderId];
    if (deliveryDate) {
      const dateCheck = await isDateAllowed(deliveryDate);
      if (!dateCheck.allowed) {
        shopify.toast.show(`❌ ${dateCheck.reason}`);
        return;
      }
    }

    const validation = postcodeValidation[orderId];
    if (validation?.status === 'invalid') {
      shopify.toast.show(`❌ Cannot send: ${validation.message}`);
      return;
    }
    if (validation?.status === 'checking') {
      shopify.toast.show("⏳ Please wait — validating postcode...");
      return;
    }

    setSendingStatus(prev => ({ ...prev, [orderId]: 'sending' }));
    setSendMessages(prev => ({ ...prev, [orderId]: '' }));

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("auth_token") : null;
      const addr = getEffectiveAddress(order);
      const fullName = addr.name || 'Unknown';
      const email = order.customer?.email || '';
      const customerPhone = addr.phone || '';
      const fullAddress = addr.address2 ? `${addr.address1}, ${addr.address2}` : addr.address1;
      const lineItems = order.lineItems?.edges || [];
      const contents = lineItems.map((edge: any) => edge.node.title).join(', ');
      const boxesCount = boxCounts[orderId] || 1;
      const orderNumber = order.name?.replace('#', '') || '0000';
      const timestamp = Date.now().toString().slice(-6);
      const doNumber = `${userPrefix}-${orderNumber}-${timestamp}`;
      const barcodes = [];
      for (let i = 1; i <= boxesCount; i++) barcodes.push(`${doNumber}-${String(i).padStart(2, '0')}`);

      const jobData = {
        do_number: doNumber, date: deliveryDate || new Date().toISOString().split('T')[0],
        time_window: "07:00-18:00",
        address: fullAddress || addr.address1 || "Address not provided",
        deliver_to: fullName, phone: customerPhone || "Not provided",
        notify_email: email, instructions: "",
        group_id: groupId || "", group_name: groupName || "",
        delivery_type: "delivery", cartons: boxesCount, boxes: boxesCount, weight: 0,
        address_1: addr.address1, address_2: addr.address2,
        postal_code: addr.zip, city: addr.city, state: addr.provinceCode,
        country: addr.country || "Australia", company_name: "",
        customer_name: fullName, contents, barcodes,
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
    // Only send UN-SENT orders
    const selectedOrderIds = getSelectedOrderIds(groupOrders).filter(id => {
      if (isOrderSent(id)) return false;
      const validation = postcodeValidation[id];
      if (validation?.status === 'invalid' || validation?.status === 'checking') return false;
      return true;
    });

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

  // ===== LOGIN PAGE =====
  if (!isLoggedIn) {
    return (
      <div style={{
        width: "100%", minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        backgroundColor: THEME.white, padding: "20px", boxSizing: "border-box"
      }}>
        <div style={{
          width: "100%", maxWidth: "420px", backgroundColor: THEME.white,
          borderRadius: "12px", padding: "48px 36px",
          boxShadow: "0 10px 30px rgba(45, 156, 219, 0.15)",
          fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }}>
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <img src="https://www.mealcart.com.au/assets/img/logo.png" alt="MealCart Logo"
              style={{ maxWidth: "180px", maxHeight: "80px", objectFit: "contain", display: "inline-block" }} />
          </div>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <h2 style={{ margin: "0 0 8px 0", color: THEME.textDark, fontSize: "24px", fontWeight: "600" }}>Welcome Back</h2>
            <p style={{ margin: "0", color: THEME.textMuted, fontSize: "14px" }}>Sign in to your MealCart account</p>
          </div>
          {loginError && (
            <div style={{ padding: "12px", backgroundColor: THEME.dangerLight, border: `1px solid ${THEME.dangerBorder}`, borderRadius: "8px", marginBottom: "20px", color: THEME.danger, fontSize: "14px" }}>
              {loginError}
            </div>
          )}
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "18px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "500", fontSize: "14px", color: THEME.textDark }}>Email</label>
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required placeholder="you@example.com"
                style={{ width: "100%", padding: "12px 14px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", backgroundColor: THEME.white }}
                onFocus={(e) => { e.target.style.borderColor = THEME.primary; e.target.style.boxShadow = `0 0 0 3px rgba(45, 156, 219, 0.15)`; }}
                onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; e.target.style.boxShadow = "none"; }}
              />
            </div>
            <div style={{ marginBottom: "28px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "500", fontSize: "14px", color: THEME.textDark }}>Password</label>
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required placeholder="••••••••" minLength={6}
                style={{ width: "100%", padding: "12px 14px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", backgroundColor: THEME.white }}
                onFocus={(e) => { e.target.style.borderColor = THEME.primary; e.target.style.boxShadow = `0 0 0 3px rgba(45, 156, 219, 0.15)`; }}
                onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; e.target.style.boxShadow = "none"; }}
              />
            </div>
            <button type="submit" disabled={isLoggingIn}
              style={{
                width: "100%", padding: "14px",
                background: isLoggingIn ? "#a8c8dc" : `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.primaryDark} 100%)`,
                color: "white", border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: "600",
                cursor: isLoggingIn ? "not-allowed" : "pointer",
                boxShadow: isLoggingIn ? "none" : "0 4px 12px rgba(45, 156, 219, 0.3)"
              }}
            >
              {isLoggingIn ? "Logging in..." : "Login"}
            </button>
          </form>
          <div style={{ marginTop: "28px", textAlign: "center", fontSize: "13px", color: THEME.textLight }}>
            Please contact your administrator if you need an account
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || loadingTime) {
    return (
      <div style={{ width: "100%", padding: "60px 20px", textAlign: "center" }}>
        <div style={{
          width: "40px", height: "40px",
          border: `4px solid ${THEME.border}`,
          borderTop: `4px solid ${THEME.primary}`,
          borderRadius: "50%", animation: "spin 1s linear infinite",
          margin: "0 auto 16px"
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <h3 style={{ margin: "0 0 8px 0", color: THEME.textDark }}>
          {loadingTime ? "Getting server time..." : "Loading your orders..."}
        </h3>
      </div>
    );
  }

  // ===== ORDERS DASHBOARD =====
  return (
    <div style={{ width: "100%", maxWidth: "100%", padding: 0, margin: 0, overflowX: "hidden" }}>
      {/* Header */}
      <div style={{
        width: "100%", backgroundColor: THEME.white,
        borderBottom: `1px solid ${THEME.border}`,
        padding: "16px 24px", boxSizing: "border-box",
        display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: "8px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="https://www.mealcart.com.au/assets/img/logo.png" alt="MealCart" style={{ height: "32px", objectFit: "contain" }} />
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "600", color: THEME.textDark,
            fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            📦 Shopify Orders
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: THEME.textMuted }}>Labels:</span>
            <select value={selectedLabelSize} onChange={(e) => setSelectedLabelSize(e.target.value)}
              style={{ padding: "5px 10px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "4px", fontSize: "12px", backgroundColor: THEME.white, cursor: "pointer", color: THEME.textDark }}>
              {LABEL_SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <button onClick={handleLogout}
            style={{ padding: "8px 20px", backgroundColor: THEME.primary, color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "14px", fontWeight: "500" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.primaryDark; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.primary; }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ width: "100%", padding: "20px 24px", boxSizing: "border-box" }}>
        {cutOffMessage && (
          <div style={{
            width: "100%", padding: "12px 16px", marginBottom: "16px",
            backgroundColor: isPastCutOff ? THEME.warningLight : THEME.primaryLight,
            border: `1px solid ${isPastCutOff ? THEME.warning : THEME.primaryBorder}`,
            borderRadius: "8px",
            color: isPastCutOff ? THEME.warning : THEME.textDark,
            fontSize: "13px", fontWeight: "500",
            display: "flex", alignItems: "center", gap: "8px"
          }}>
            {cutOffMessage}
          </div>
        )}

        <div style={{
          width: "100%", backgroundColor: THEME.white,
          borderRadius: "8px", border: `1px solid ${THEME.border}`,
          padding: "20px 24px", boxSizing: "border-box"
        }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600", color: THEME.textDark }}>
            Recent Orders
          </h3>

          {error && (
            <div style={{ padding: "12px", backgroundColor: THEME.dangerLight, borderRadius: "4px", marginBottom: "16px", color: THEME.danger }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {orders.length === 0 && !error ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>📦</div>
              <h3 style={{ margin: "0 0 8px 0", color: THEME.textDark }}>No orders yet</h3>
              <p style={{ margin: 0, color: THEME.textMuted }}>Check back later!</p>
            </div>
          ) : orders.length > 0 ? (
            <div style={{ width: "100%" }}>
              {groupedOrders.map((group) => {
                const groupKey = group.date;
                const allSelected = areAllSelected(group.orders);
                const selectedCount = getSelectedOrderIds(group.orders).length;
                const unsentSelectedCount = getSelectedOrderIds(group.orders).filter(id => !isOrderSent(id)).length;
                const sentSelectedCount = getSelectedOrderIds(group.orders).filter(id => isOrderSent(id)).length;
                const isBatchSending = batchSending[groupKey] || false;

                return (
                  <div key={groupKey} style={{ marginBottom: "32px" }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: "12px",
                      borderBottom: `1px solid ${THEME.border}`,
                      paddingBottom: "8px", flexWrap: "wrap", gap: "8px"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <input type="checkbox" checked={allSelected} onChange={(e) => handleSelectAll(groupKey, e.target.checked, group.orders)}
                          style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: THEME.primary }} />
                        <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: THEME.textDark }}>
                          {getDateGroupName(groupKey)}
                          <span style={{ fontSize: "13px", fontWeight: "400", color: THEME.textMuted, marginLeft: "8px" }}>
                            ({group.orders.length} order{group.orders.length > 1 ? 's' : ''})
                          </span>
                          {selectedCount > 0 && (
                            <span style={{ fontSize: "12px", color: THEME.warning, marginLeft: "8px" }}>
                              • {selectedCount} selected
                              {unsentSelectedCount > 0 && ` (${unsentSelectedCount} unsent`}
                              {unsentSelectedCount > 0 && sentSelectedCount > 0 && `, `}
                              {sentSelectedCount > 0 && `${sentSelectedCount} sent)`}
                            </span>
                          )}
                        </h4>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {/* Send Selected (only for unsent orders) */}
                        {unsentSelectedCount > 0 && (
                          <button
                            onClick={() => sendBatchToMealCart(groupKey, group.orders)}
                            disabled={isBatchSending}
                            style={{
                              padding: "6px 16px",
                              backgroundColor: isBatchSending ? THEME.textLight : THEME.primary,
                              color: "white", border: "none", borderRadius: "4px",
                              cursor: isBatchSending ? "not-allowed" : "pointer",
                              fontSize: "12px", fontWeight: "500"
                            }}
                          >
                            {isBatchSending ? `⏳ Sending ${unsentSelectedCount}...` : `📤 Send Selected (${unsentSelectedCount})`}
                          </button>
                        )}

                        {/* Print Labels (only for sent orders) */}
                        {sentSelectedCount > 0 && (
                          <button
                            onClick={() => openBulkLabelsModal(groupKey, group.orders)}
                            style={{
                              padding: "6px 16px",
                              backgroundColor: THEME.success,
                              color: "white", border: "none", borderRadius: "4px",
                              cursor: "pointer",
                              fontSize: "12px", fontWeight: "500",
                              display: "flex", alignItems: "center", gap: "6px"
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#004e3a"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.success; }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 6 2 18 2 18 9"></polyline>
                              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                              <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                            🖨️ Print Labels ({sentSelectedCount})
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ overflowX: "auto", width: "100%" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", minWidth: "1500px" }}>
                        <thead>
                          <tr>
                            {['Select', 'Order', 'Customer', 'Email', 'Phone', 'Address', 'Items', 'Total', 'Delivery Date', 'Boxes', 'Postcode Status', 'Action'].map(h => (
                              <th key={h} style={{
                                padding: "10px 6px",
                                borderBottom: `1px solid ${THEME.border}`,
                                fontWeight: "600", fontSize: "11px", color: THEME.textMuted,
                                whiteSpace: "nowrap",
                                width: h === 'Select' ? "40px" : "auto"
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.orders.map((order: any, index: number) => {
                            const orderId = order.id;
                            const isSending = sendingStatus[orderId] === 'sending';
                            const isError = sendingStatus[orderId] === 'error';
                            const message = sendMessages[orderId] || '';
                            const sent = isOrderSent(orderId);
                            const sentDetails = getSentOrderDetails(orderId);
                            const validation = postcodeValidation[orderId] || { status: 'idle' };
                            const addr = getEffectiveAddress(order);
                            const hasEditedAddress = !!editedAddresses[orderId];
                            const fullAddress = [addr.address1, addr.address2, addr.city, addr.provinceCode, addr.zip].filter(Boolean).join(', ') || 'N/A';
                            const fullName = addr.name || 'Guest';
                            const email = order.customer?.email || 'N/A';
                            const phone = addr.phone || 'N/A';
                            const itemCount = order.lineItems?.edges?.length || 0;

                            const selectedDate = deliveryDates[orderId];
                            const isDateBlocked = !!(selectedDate && dateInfo.isPastCutOff && selectedDate === dateInfo.tomorrow);

                            const canSend = !sent &&
                                           validation.status !== 'invalid' &&
                                           validation.status !== 'checking' &&
                                           validation.status !== 'no-postcode' &&
                                           !isDateBlocked;

                            return (
                              <tr key={orderId || index}>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <input type="checkbox" checked={selectedOrders[orderId] || false}
                                    onChange={(e) => handleSelectOrder(orderId, e.target.checked)}
                                    disabled={isSending}
                                    style={{ width: "15px", height: "15px", accentColor: THEME.primary }} />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <a href={`https://admin.shopify.com/apps/orders/${orderId?.split('/').pop()}`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ color: THEME.primary, textDecoration: "none", fontWeight: "600" }}>
                                    {order.name}
                                  </a>
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  {fullName}
                                  {hasEditedAddress && <span style={{ marginLeft: "6px", fontSize: "10px", color: THEME.primary, fontWeight: "600" }}>(edited)</span>}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px" }}>{email}</td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px" }}>{phone}</td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px", maxWidth: "240px", position: "relative" }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
                                    <div style={{ flex: 1, wordBreak: "break-word" }}>{fullAddress}</div>
                                    <button onClick={() => openEditModal(order)} disabled={sent}
                                      title={sent ? "Cannot edit — order already sent" : "Edit address"}
                                      style={{
                                        padding: "2px", background: "none",
                                        border: `1px solid ${THEME.primaryBorder}`, borderRadius: "4px",
                                        cursor: sent ? "not-allowed" : "pointer",
                                        color: THEME.primary,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0, opacity: sent ? 0.4 : 1, transition: "all 0.15s"
                                      }}
                                      onMouseEnter={(e) => { if (!sent) { e.currentTarget.style.backgroundColor = THEME.primaryLight; e.currentTarget.style.borderColor = THEME.primary; } }}
                                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = THEME.primaryBorder; }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px" }}>{itemCount} items</td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontWeight: "600", fontSize: "12px" }}>
                                  {order.totalPriceSet?.shopMoney?.amount || '0.00'} {order.totalPriceSet?.shopMoney?.currencyCode || 'USD'}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <input type="date" value={deliveryDates[orderId] || ''} min={minAllowedDate}
                                    onChange={(e) => updateDeliveryDate(orderId, e.target.value)}
                                    style={{
                                      padding: "5px 6px",
                                      border: `1px solid ${isDateBlocked || validation.status === 'invalid' ? THEME.danger : THEME.primaryBorder}`,
                                      borderRadius: "4px", fontSize: "12px",
                                      width: "130px", color: THEME.textDark,
                                      backgroundColor: isDateBlocked ? THEME.dangerLight : THEME.white
                                    }}
                                    disabled={sent || isSending}
                                  />
                                  {isDateBlocked && !sent && (
                                    <div style={{ fontSize: "10px", color: THEME.danger, marginTop: "3px", fontWeight: "600" }}>
                                      ⏰ Past 4 PM — not available
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <input type="number" min="1" max="100" value={boxCounts[orderId] || 1}
                                    onChange={(e) => updateBoxCount(orderId, parseInt(e.target.value) || 1)}
                                    style={{
                                      padding: "5px 6px", border: `1px solid ${THEME.primaryBorder}`,
                                      borderRadius: "4px", fontSize: "12px", width: "55px",
                                      color: THEME.textDark, backgroundColor: THEME.white
                                    }}
                                    disabled={sent || isSending}
                                  />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, minWidth: "200px" }}>
                                  {sent ? (
                                    <span style={{ fontSize: "11px", color: THEME.textMuted }}>— (already sent)</span>
                                  ) : validation.status === 'checking' ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: THEME.textMuted }}>
                                      <div style={{ width: "12px", height: "12px", border: `2px solid ${THEME.border}`, borderTop: `2px solid ${THEME.primary}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                                      Checking...
                                    </div>
                                  ) : validation.status === 'valid' ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                      <span style={{ display: "inline-block", padding: "3px 8px", backgroundColor: THEME.successLight, color: THEME.success, border: `1px solid ${THEME.success}`, borderRadius: "4px", fontSize: "11px", fontWeight: "600" }}>
                                        ✅ Deliverable
                                      </span>
                                      {validation.suburb && <div style={{ fontSize: "10px", color: THEME.textMuted }}>{validation.suburb}{validation.run ? ` • ${validation.run}` : ''}</div>}
                                    </div>
                                  ) : validation.status === 'invalid' ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "6px 8px", backgroundColor: THEME.dangerLight, border: `1px solid ${THEME.dangerBorder}`, borderRadius: "4px" }}>
                                      <span style={{ fontSize: "11px", fontWeight: "600", color: THEME.danger }}>❌ Not Deliverable</span>
                                      {validation.suburb && <div style={{ fontSize: "10px", color: THEME.textMuted }}>{validation.suburb}{validation.run ? ` • ${validation.run}` : ''}</div>}
                                      <div style={{ fontSize: "10px", color: THEME.danger }}>{validation.message}</div>
                                      {validation.nextAvailableDay && (
                                        <div style={{ fontSize: "10px", color: THEME.success, fontWeight: "600" }}>
                                          ✅ Next: {validation.nextAvailableDay}{validation.nextAvailableDate ? ` (${validation.nextAvailableDate})` : ''}
                                        </div>
                                      )}
                                    </div>
                                  ) : validation.status === 'no-postcode' ? (
                                    <span style={{ fontSize: "11px", color: THEME.danger }}>⚠️ No postcode in order</span>
                                  ) : (
                                    <span style={{ fontSize: "11px", color: THEME.textMuted }}>Waiting...</span>
                                  )}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  {sent ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <span style={{ display: "inline-block", padding: "5px 12px", backgroundColor: THEME.successLight, color: THEME.success, border: `1px solid ${THEME.success}`, borderRadius: "4px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", textAlign: "center" }}>
                                        ✅ Sent
                                      </span>
                                      <div style={{ fontSize: "9px", color: THEME.textMuted, textAlign: "center" }}>DO: {sentDetails?.doNumber || "N/A"}</div>
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <button
                                        onClick={() => sendToMealCart(order)}
                                        disabled={isSending || !canSend}
                                        title={
                                          isDateBlocked ? "Tomorrow is not available — it's past 4 PM AEST"
                                          : validation.status === 'invalid' ? `Cannot send: ${validation.message}`
                                          : validation.status === 'checking' ? "Please wait — validating postcode"
                                          : !canSend ? "Cannot send this order" : "Send to MealCart"
                                        }
                                        style={{
                                          padding: "5px 12px",
                                          backgroundColor: !canSend ? "#ccc" : isError ? THEME.danger : THEME.primary,
                                          color: "white", border: "none", borderRadius: "4px",
                                          cursor: (!canSend || isSending) ? "not-allowed" : "pointer",
                                          fontSize: "12px", fontWeight: "500", whiteSpace: "nowrap",
                                          opacity: !canSend ? 0.6 : 1
                                        }}
                                      >
                                        {isSending ? "⏳ Sending..."
                                          : isDateBlocked ? "⏰ Blocked"
                                          : validation.status === 'invalid' ? "🚫 Blocked"
                                          : validation.status === 'checking' ? "⏳ Wait..."
                                          : isError ? "⚠️ Retry"
                                          : "📤 Send"}
                                      </button>
                                      {message && (
                                        <div style={{ fontSize: "10px", color: isError ? THEME.danger : THEME.textMuted, textAlign: "center" }}>
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

      {/* ===== BULK LABELS MODAL ===== */}
      {showBulkLabelsModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "20px", boxSizing: "border-box"
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !bulkLabelsGenerating) {
            setShowBulkLabelsModal(false);
          }
        }}>
          <div style={{
            backgroundColor: THEME.white, borderRadius: "12px",
            padding: "28px", maxWidth: "640px", maxHeight: "90vh",
            overflow: "auto", width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", borderBottom: `1px solid ${THEME.border}`, paddingBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={THEME.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"></polyline>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                  <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                <div>
                  <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "600", color: THEME.textDark }}>Print Shipping Labels</h2>
                  <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: THEME.textMuted }}>
                    {bulkLabelsBookings.length} job{bulkLabelsBookings.length !== 1 ? 's' : ''} selected
                  </p>
                </div>
              </div>
              <button onClick={() => !bulkLabelsGenerating && setShowBulkLabelsModal(false)} disabled={bulkLabelsGenerating}
                style={{ background: "none", border: "none", fontSize: "24px", cursor: bulkLabelsGenerating ? "not-allowed" : "pointer", color: THEME.textMuted, padding: 0, width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px", opacity: bulkLabelsGenerating ? 0.5 : 1 }}>
                ×
              </button>
            </div>

            {/* Jobs Summary */}
            <div style={{
              padding: "14px 16px", backgroundColor: "#f8fbfd",
              borderRadius: "8px", marginBottom: "20px",
              border: `1px solid ${THEME.primaryBorder}`
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", color: THEME.textDark }}>
                  Selected Jobs
                </span>
                <span style={{ fontSize: "12px", color: THEME.textMuted }}>
                  {bulkLabelsBookings.reduce((sum, b) => sum + (boxCounts[b.id] || sentOrders[b.id]?.boxes || 1), 0)} total labels
                </span>
              </div>
              <div style={{ maxHeight: "120px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                {bulkLabelsBookings.map((order: any) => {
                  const sentDetails = sentOrders[order.id];
                  const labelCount = boxCounts[order.id] || sentDetails?.boxes || 1;
                  const addr = getEffectiveAddress(order);
                  return (
                    <div key={order.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      fontSize: "12px", padding: "6px 10px",
                      backgroundColor: THEME.white,
                      border: `1px solid ${THEME.border}`,
                      borderRadius: "4px"
                    }}>
                      <span style={{ fontFamily: "monospace", color: THEME.textDark, fontWeight: "600" }}>
                        {sentDetails?.doNumber || '—'}
                      </span>
                      <span style={{ color: THEME.textMuted }}>
                        {addr.name} • {labelCount} label{labelCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Progress Bar */}
            {bulkLabelsGenerating && (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "8px" }}>
                  <span style={{ color: THEME.textMuted }}>
                    Generating combined PDF... ({bulkLabelsCurrentJob}/{bulkLabelsBookings.length})
                  </span>
                  <span style={{ fontWeight: "600", color: THEME.textDark }}>{bulkLabelsProgress}%</span>
                </div>
                <div style={{ height: "10px", width: "100%", overflow: "hidden", borderRadius: "5px", backgroundColor: THEME.border }}>
                  <div style={{
                    height: "100%", borderRadius: "5px",
                    background: `linear-gradient(90deg, ${THEME.primary} 0%, ${THEME.primaryDark} 100%)`,
                    width: `${bulkLabelsProgress}%`,
                    transition: "width 0.3s ease"
                  }} />
                </div>
              </div>
            )}

            {/* Error */}
            {bulkLabelsError && (
              <div style={{
                padding: "12px 14px", backgroundColor: THEME.dangerLight,
                border: `1px solid ${THEME.dangerBorder}`, borderRadius: "8px",
                marginBottom: "20px", color: THEME.danger, fontSize: "13px"
              }}>
                <strong>Error:</strong> {bulkLabelsError}
              </div>
            )}

            {/* Layout Selection */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: THEME.textDark, marginBottom: "10px" }}>
                Select Label Layout
              </label>
              <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto", paddingRight: "4px" }}>
                {LABEL_SIZES.map((layout) => {
                  const isSelected = bulkLabelsLayout === layout.id;
                  return (
                    <button
                      key={layout.id}
                      onClick={() => setBulkLabelsLayout(layout.id)}
                      disabled={bulkLabelsGenerating}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "12px 14px", borderRadius: "8px",
                        border: `2px solid ${isSelected ? THEME.primary : THEME.border}`,
                        backgroundColor: isSelected ? THEME.primaryLight : THEME.white,
                        cursor: bulkLabelsGenerating ? "not-allowed" : "pointer",
                        opacity: bulkLabelsGenerating ? 0.6 : 1,
                        transition: "all 0.15s",
                        textAlign: "left"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{
                          width: "18px", height: "18px", borderRadius: "50%",
                          border: `2px solid ${isSelected ? THEME.primary : THEME.primaryBorder}`,
                          backgroundColor: isSelected ? THEME.primary : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0
                        }}>
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: "600", color: THEME.textDark }}>
                            {layout.label}
                          </div>
                          <div style={{ fontSize: "12px", color: THEME.textMuted, marginTop: "2px" }}>
                            {layout.description}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <span style={{ fontSize: "11px", color: THEME.primary, fontWeight: "600" }}>
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Info Box */}
            <div style={{
              padding: "12px 14px", backgroundColor: "#e8f4f8",
              border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px",
              marginBottom: "20px"
            }}>
              <p style={{ margin: 0, fontSize: "12px", color: THEME.textDark, lineHeight: "1.5" }}>
                💡 All {bulkLabelsBookings.length} selected job{bulkLabelsBookings.length !== 1 ? 's' : ''} will be combined into <strong>one PDF</strong> with{' '}
                <strong>
                  {bulkLabelsLayout === "4-per-page" ? "4"
                    : bulkLabelsLayout === "6-per-page" ? "6"
                    : bulkLabelsLayout === "8-per-page-1" || bulkLabelsLayout === "8-per-page-2" ? "8"
                    : "custom"}
                </strong> labels per page. A single download will be triggered.
              </p>
            </div>

            {/* Footer Buttons */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowBulkLabelsModal(false)}
                disabled={bulkLabelsGenerating}
                style={{
                  padding: "10px 20px", backgroundColor: THEME.white,
                  color: THEME.textDark, border: `1px solid ${THEME.primaryBorder}`,
                  borderRadius: "8px", cursor: bulkLabelsGenerating ? "not-allowed" : "pointer",
                  fontSize: "14px", fontWeight: "500",
                  opacity: bulkLabelsGenerating ? 0.5 : 1
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateBulkLabels}
                disabled={bulkLabelsGenerating}
                style={{
                  padding: "10px 24px",
                  background: bulkLabelsGenerating
                    ? "#a8c8dc"
                    : `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.primaryDark} 100%)`,
                  color: "white", border: "none", borderRadius: "8px",
                  cursor: bulkLabelsGenerating ? "not-allowed" : "pointer",
                  fontSize: "14px", fontWeight: "600",
                  boxShadow: bulkLabelsGenerating ? "none" : "0 4px 12px rgba(45, 156, 219, 0.3)",
                  display: "flex", alignItems: "center", gap: "8px"
                }}
              >
                {bulkLabelsGenerating ? (
                  <>
                    <div style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid white", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 6 2 18 2 18 9"></polyline>
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                      <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    Generate All Labels
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADDRESS EDIT MODAL ===== */}
      {editingOrder && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: "20px", boxSizing: "border-box"
          }}
          onClick={(e) => { if (e.target === e.currentTarget) cancelEdit(); }}
        >
          <div style={{
            backgroundColor: THEME.white, borderRadius: "12px", padding: "28px",
            maxWidth: "600px", maxHeight: "90vh", overflow: "auto", width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
              <div>
                <h2 style={{ margin: "0 0 4px 0", fontSize: "20px", fontWeight: "600", color: THEME.textDark }}>
                  ✏️ Edit Delivery Address
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: THEME.textMuted }}>
                  Order <strong>{editingOrder.name}</strong>
                </p>
              </div>
              <button onClick={cancelEdit}
                style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: THEME.textMuted, padding: 0, width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.primaryLight; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                ×
              </button>
            </div>

            <div style={{
              padding: "10px 14px", backgroundColor: THEME.primaryLight,
              border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px",
              marginBottom: "20px", fontSize: "12px", color: THEME.textDark
            }}>
              💡 This edits the address for <strong>this delivery only</strong>. It will not update the original Shopify order.
            </div>

            <div style={{ display: "grid", gap: "16px" }}>
              {[
                { label: 'Recipient Name', key: 'name', placeholder: '' },
                { label: 'Phone Number', key: 'phone', placeholder: '0412 345 678' },
                { label: 'Address Line 1', key: 'address1', placeholder: '123 Main St' },
              ].map(field => (
                <div key={field.key}>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                    {field.label}
                  </label>
                  <input type="text" value={(editForm as any)[field.key]}
                    onChange={(e) => setEditForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: `1px solid ${THEME.primaryBorder}`,
                      borderRadius: "8px", fontSize: "14px",
                      boxSizing: "border-box", outline: "none",
                      backgroundColor: THEME.white, color: THEME.textDark
                    }}
                    onFocus={(e) => { e.target.style.borderColor = THEME.primary; }}
                    onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; }}
                  />
                </div>
              ))}

              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                  Address Line 2 <span style={{ color: THEME.textMuted, fontWeight: "400" }}>(optional)</span>
                </label>
                <input type="text" value={editForm.address2}
                  onChange={(e) => setEditForm(prev => ({ ...prev, address2: e.target.value }))}
                  placeholder="Apt, Suite, Building..."
                  style={{
                    width: "100%", padding: "10px 12px",
                    border: `1px solid ${THEME.primaryBorder}`,
                    borderRadius: "8px", fontSize: "14px",
                    boxSizing: "border-box", outline: "none",
                    backgroundColor: THEME.white, color: THEME.textDark
                  }}
                  onFocus={(e) => { e.target.style.borderColor = THEME.primary; }}
                  onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>City</label>
                  <input type="text" value={editForm.city}
                    onChange={(e) => setEditForm(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="Melbourne"
                    style={{ width: "100%", padding: "10px 12px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", backgroundColor: THEME.white, color: THEME.textDark }}
                    onFocus={(e) => { e.target.style.borderColor = THEME.primary; }}
                    onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>State</label>
                  <select value={editForm.provinceCode}
                    onChange={(e) => setEditForm(prev => ({ ...prev, provinceCode: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", backgroundColor: THEME.white, color: THEME.textDark, cursor: "pointer" }}>
                    <option value="">Select state...</option>
                    <option value="NSW">NSW — New South Wales</option>
                    <option value="VIC">VIC — Victoria</option>
                    <option value="QLD">QLD — Queensland</option>
                    <option value="WA">WA — Western Australia</option>
                    <option value="SA">SA — South Australia</option>
                    <option value="TAS">TAS — Tasmania</option>
                    <option value="ACT">ACT — Australian Capital Territory</option>
                    <option value="NT">NT — Northern Territory</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>Postcode</label>
                  <input type="text" value={editForm.zip}
                    onChange={(e) => setEditForm(prev => ({ ...prev, zip: e.target.value }))}
                    placeholder="3000"
                    style={{ width: "100%", padding: "10px 12px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", backgroundColor: THEME.white, color: THEME.textDark }}
                    onFocus={(e) => { e.target.style.borderColor = THEME.primary; }}
                    onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>Country</label>
                  <input type="text" value={editForm.country}
                    onChange={(e) => setEditForm(prev => ({ ...prev, country: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", backgroundColor: THEME.white, color: THEME.textDark }}
                    onFocus={(e) => { e.target.style.borderColor = THEME.primary; }}
                    onBlur={(e) => { e.target.style.borderColor = THEME.primaryBorder; }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "24px" }}>
              <button onClick={cancelEdit} disabled={editSaving}
                style={{ padding: "10px 20px", backgroundColor: THEME.white, color: THEME.textDark, border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px", cursor: editSaving ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500" }}>
                Cancel
              </button>
              <button onClick={saveEditedAddress} disabled={editSaving}
                style={{
                  padding: "10px 20px",
                  background: editSaving ? "#a8c8dc" : `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.primaryDark} 100%)`,
                  color: "white", border: "none", borderRadius: "8px",
                  cursor: editSaving ? "not-allowed" : "pointer",
                  fontSize: "14px", fontWeight: "600",
                  boxShadow: editSaving ? "none" : "0 4px 12px rgba(45, 156, 219, 0.3)"
                }}
              >
                {editSaving ? "Saving..." : "Save Address"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};