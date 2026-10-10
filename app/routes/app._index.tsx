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
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ===== CUT-OFF TIME CONFIG =====
const CUT_OFF_HOUR = 16; // 4 PM
const CUT_OFF_MINUTE = 0;

// ===== SERVER TIME CACHE =====
let serverTimeCache: Date | null = null;
let serverTimeFetchPromise: Promise<Date> | null = null;

// ===== GET SERVER TIME (with caching + fallback) =====
const getServerTimeSecure = async (): Promise<Date> => {
  // Return cached time if less than 5 seconds old
  if (serverTimeCache) {
    const age = Date.now() - serverTimeCache.getTime();
    if (age < 5000) {
      return serverTimeCache;
    }
  }

  // Wait for in-flight request
  if (serverTimeFetchPromise) {
    return serverTimeFetchPromise;
  }

  serverTimeFetchPromise = fetch("https://dtrack-backend-0zzv.onrender.com/api/time/server-time", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    mode: "cors",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch server time: ${response.status}`);
      }
      const data = await response.json();
      const time = new Date(data.time);
      serverTimeCache = time;
      serverTimeFetchPromise = null;
      console.log('✅ Server time fetched:', data.time);
      return time;
    })
    .catch((error) => {
      serverTimeFetchPromise = null;
      console.error('❌ Failed to fetch server time, using device time as fallback:', error);
      return new Date(); // Fallback to device time
    });

  return serverTimeFetchPromise;
};

// ===== GET AUSTRALIAN TIME (AEST/AEDT) =====
const getAustralianTime = async (): Promise<{ date: Date; hour: number; minutes: number; dateStr: string }> => {
  const serverTime = await getServerTimeSecure();

  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
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
  const ausHour = parseInt(hour);
  const ausMinutes = parseInt(minute);

  return {
    date: ausDate,
    hour: ausHour,
    minutes: ausMinutes,
    dateStr: `${year}-${month}-${day}`
  };
};

// ===== CHECK IF PAST CUT-OFF (4 PM) =====
const isPastCutOff = (hour: number, minutes: number): boolean => {
  return hour > CUT_OFF_HOUR || (hour === CUT_OFF_HOUR && minutes > CUT_OFF_MINUTE);
};

// ===== GET MINIMUM ALLOWED DATE =====
const getMinAllowedDate = async (): Promise<string> => {
  const aus = await getAustralianTime();
  const daysToAdd = isPastCutOff(aus.hour, aus.minutes) ? 2 : 1;
  const targetDate = new Date(aus.date);
  targetDate.setUTCDate(targetDate.getUTCDate() + daysToAdd);
  return targetDate.toISOString().split('T')[0];
};

// ===== GET DATE INFO =====
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

// ===== CHECK IF A DATE IS ALLOWED =====
const isDateAllowed = async (dateStr: string): Promise<{ allowed: boolean; reason?: string }> => {
  const info = await getDateInfo();

  // TODAY - always allowed
  if (dateStr === info.today) {
    return { allowed: true };
  }

  // TOMORROW - only allowed if BEFORE 4 PM AEST
  if (dateStr === info.tomorrow) {
    if (!info.isPastCutOff) {
      return { allowed: true };
    } else {
      const formattedDate = info.dayAfterTomorrowObj.toLocaleDateString('en-AU', {
        timeZone: 'Australia/Sydney',
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
      return {
        allowed: false,
        reason: `Tomorrow is not available because it's past 4 PM (AEST time). Please select ${formattedDate} or later.`
      };
    }
  }

  // DAY AFTER TOMORROW or later - always allowed
  return { allowed: true };
};

// ===== FORMAT DATE DISPLAY =====
const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Sydney',
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
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

  // ===== CUT-OFF TIME STATE =====
  const [loadingTime, setLoadingTime] = useState(true);
  const [minAllowedDate, setMinAllowedDate] = useState<string>("");
  const [cutOffMessage, setCutOffMessage] = useState<string | null>(null);
  const [isPastCutOff, setIsPastCutOff] = useState(false);
  const [dateInfo, setDateInfo] = useState<{ isPastCutOff: boolean; tomorrow: string }>({
    isPastCutOff: false,
    tomorrow: "",
  });

  // ===== DELIVERY STATE =====
  const [deliveryDates, setDeliveryDates] = useState<{ [key: string]: string }>({});
  const [boxCounts, setBoxCounts] = useState<{ [key: string]: number }>({});
  const [sendingStatus, setSendingStatus] = useState<{ [key: string]: 'idle' | 'sending' | 'success' | 'error' }>({});
  const [sendMessages, setSendMessages] = useState<{ [key: string]: string }>({});

  // ===== EDITED ADDRESS STATE =====
  const [editedAddresses, setEditedAddresses] = useState<{
    [orderId: string]: {
      name: string;
      phone: string;
      address1: string;
      address2: string;
      city: string;
      provinceCode: string;
      zip: string;
      country: string;
    }
  }>({});

  // ===== ADDRESS EDIT MODAL STATE =====
  const [editingOrder, setEditingOrder] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', phone: '', address1: '', address2: '', city: '',
    provinceCode: '', zip: '', country: 'Australia',
  });
  const [editSaving, setEditSaving] = useState(false);

  // ===== POSTCODE VALIDATION STATE =====
  const [postcodeValidation, setPostcodeValidation] = useState<{
    [orderId: string]: {
      status: 'idle' | 'checking' | 'valid' | 'invalid' | 'no-postcode';
      suburb?: string;
      postCode?: string;
      run?: string;
      message?: string;
      selectedDay?: string;
      nextAvailableDay?: string;
      nextAvailableDate?: string;
      days?: any;
    }
  }>({});

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
      name: addr.name,
      phone: addr.phone,
      address1: addr.address1,
      address2: addr.address2,
      city: addr.city,
      provinceCode: addr.provinceCode,
      zip: addr.zip,
      country: addr.country,
    });
  };

  // ===== SAVE EDITED ADDRESS =====
  const saveEditedAddress = () => {
    if (!editingOrder) return;
    setEditSaving(true);

    setEditedAddresses(prev => ({
      ...prev,
      [editingOrder.id]: {
        name: editForm.name,
        phone: editForm.phone,
        address1: editForm.address1,
        address2: editForm.address2,
        city: editForm.city,
        provinceCode: editForm.provinceCode,
        zip: editForm.zip,
        country: editForm.country,
      }
    }));

    // Clear validation for this order (will re-run on postcode change)
    setPostcodeValidation(prev => {
      const next = { ...prev };
      delete next[editingOrder.id];
      return next;
    });

    shopify.toast.show("Address updated");
    setEditingOrder(null);
    setEditSaving(false);
  };

  const cancelEdit = () => {
    setEditingOrder(null);
  };

  // ===== INITIALIZE CUT-OFF TIME ON MOUNT =====
  useEffect(() => {
    const initializeDates = async () => {
      setLoadingTime(true);
      try {
        const info = await getDateInfo();
        const minDate = await getMinAllowedDate();
        setMinAllowedDate(minDate);
        setDateInfo({
          isPastCutOff: info.isPastCutOff,
          tomorrow: info.tomorrow,
        });

        if (info.isPastCutOff) {
          setIsPastCutOff(true);
          const formattedDate = formatDateDisplay(info.dayAfterTomorrow);
          setCutOffMessage(
            `⏰ It's past 4 PM (AEST time). The earliest available date is ${formattedDate} (day after tomorrow).`
          );
        } else {
          setIsPastCutOff(false);
          const formattedDate = formatDateDisplay(info.tomorrow);
          setCutOffMessage(
            `📅 Tomorrow (${formattedDate}) is available. Book before 4 PM (AEST time) for next-day delivery.`
          );
        }
      } catch (error) {
        console.error('❌ Failed to initialize dates:', error);
        // Fallback: use device time
        const fallbackDate = new Date().toISOString().split('T')[0];
        setMinAllowedDate(fallbackDate);
        setCutOffMessage('⚠️ Using device time. Please check your system clock.');
      } finally {
        setLoadingTime(false);
      }
    };

    initializeDates();
  }, []);

  // ===== LOAD FROM LOCALSTORAGE ON MOUNT =====
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

  // Persist sent orders
  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(sentOrders).length > 0) {
      localStorage.setItem(SENT_ORDERS_KEY, JSON.stringify(sentOrders));
    }
  }, [sentOrders]);

  // Persist edited addresses
  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(editedAddresses).length > 0) {
      localStorage.setItem('shopify_edited_addresses', JSON.stringify(editedAddresses));
    }
  }, [editedAddresses]);

  // Persist label size
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

  // Load orders
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

  // ===== POSTCODE VALIDATION (no 4-digit check) =====
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
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
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
          [orderId]: {
            status: 'invalid',
            message: data.error || `Postcode ${postcode} is not deliverable`,
            postCode: postcode,
          }
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
          [orderId]: {
            status: 'valid',
            postCode: postcode,
            suburb,
            run,
            selectedDay: dayName,
            message: `Deliverable on ${dayName}`,
            days,
          }
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
            status: 'invalid',
            postCode: postcode,
            suburb,
            run,
            selectedDay: dayName,
            message: `No delivery to ${postcode}${suburb ? ` (${suburb})` : ''} on ${dayName}`,
            nextAvailableDay,
            nextAvailableDate,
            days,
          }
        }));
      }
    } catch (error) {
      console.error('Postcode validation error:', error);
      setPostcodeValidation(prev => ({
        ...prev,
        [orderId]: {
          status: 'invalid',
          message: 'Failed to validate postcode',
          postCode: postcode,
        }
      }));
    }
  };

  // ===== AUTO-VALIDATE — SKIPS ALREADY SENT ORDERS =====
  useEffect(() => {
    if (!isLoggedIn || orders.length === 0 || loadingTime) return;

    const timers: NodeJS.Timeout[] = [];

    orders.forEach(order => {
      if (sentOrders[order.id]) return;

      const addr = getEffectiveAddress(order);
      const postcode = (addr.zip || '').trim();
      const date = deliveryDates[order.id];

      if (postcode && date) {
        const timer = setTimeout(() => {
          validatePostcodeForOrder(order.id, postcode, date);
        }, 500);
        timers.push(timer);
      } else if (!postcode) {
        setPostcodeValidation(prev => ({
          ...prev,
          [order.id]: { status: 'no-postcode', message: 'No postcode in order' }
        }));
      }
    });

    return () => {
      timers.forEach(t => clearTimeout(t));
    };
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
    if (checked && postcodeValidation[orderId]?.status === 'invalid') {
      shopify.toast.show("Cannot select: invalid postcode for the selected date");
      return;
    }
    setSelectedOrders(prev => ({ ...prev, [orderId]: checked }));
  };

  const handleSelectAll = (groupKey: string, checked: boolean, groupOrders: any[]) => {
    const newSelected = { ...selectedOrders };
    groupOrders.forEach(order => {
      if (checked && postcodeValidation[order.id]?.status === 'invalid') {
        newSelected[order.id] = false;
      } else {
        newSelected[order.id] = checked;
      }
    });
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

  const sendToMealCart = async (order: any) => {
    const orderId = order.id;

    if (isOrderSent(orderId)) {
      shopify.toast.show("This order has already been sent");
      return;
    }

    // ✅ NEW: Check date cut-off rule before sending
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
        do_number: doNumber,
        date: deliveryDate || new Date().toISOString().split('T')[0],
        time_window: "07:00-18:00",
        address: fullAddress || addr.address1 || "Address not provided",
        deliver_to: fullName,
        phone: customerPhone || "Not provided",
        notify_email: email,
        instructions: "",
        group_id: groupId || "",
        group_name: groupName || "",
        delivery_type: "delivery",
        cartons: boxesCount,
        boxes: boxesCount,
        weight: 0,
        address_1: addr.address1,
        address_2: addr.address2,
        postal_code: addr.zip,
        city: addr.city,
        state: addr.provinceCode,
        country: addr.country || "Australia",
        company_name: "",
        customer_name: fullName,
        contents,
        barcodes,
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
    const selectedOrderIds = getSelectedOrderIds(groupOrders).filter(id => {
      if (isOrderSent(id)) return false;
      const validation = postcodeValidation[id];
      if (validation?.status === 'invalid' || validation?.status === 'checking') return false;
      return true;
    });

    if (selectedOrderIds.length === 0) {
      shopify.toast.show("No valid orders selected");
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
        width: "100%", minHeight: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: THEME.white, padding: "20px", boxSizing: "border-box"
      }}>
        <div style={{
          width: "100%", maxWidth: "420px", backgroundColor: THEME.white,
          borderRadius: "12px", padding: "48px 36px",
          boxShadow: "0 10px 30px rgba(45, 156, 219, 0.15)",
          fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }}>
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <img
              src="https://www.mealcart.com.au/assets/img/logo.png"
              alt="MealCart Logo"
              style={{ maxWidth: "180px", maxHeight: "80px", objectFit: "contain", display: "inline-block" }}
            />
          </div>

          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <h2 style={{ margin: "0 0 8px 0", color: THEME.textDark, fontSize: "24px", fontWeight: "600" }}>
              Welcome Back
            </h2>
            <p style={{ margin: "0", color: THEME.textMuted, fontSize: "14px" }}>
              Sign in to your MealCart account
            </p>
          </div>

          {loginError && (
            <div style={{
              padding: "12px", backgroundColor: THEME.dangerLight,
              border: `1px solid ${THEME.dangerBorder}`, borderRadius: "8px",
              marginBottom: "20px", color: THEME.danger, fontSize: "14px"
            }}>
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "18px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "500", fontSize: "14px", color: THEME.textDark }}>
                Email
              </label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                placeholder="you@example.com"
                style={{
                  width: "100%", padding: "12px 14px",
                  border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px",
                  fontSize: "14px", boxSizing: "border-box", outline: "none",
                  backgroundColor: THEME.white
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = THEME.primary;
                  e.target.style.boxShadow = `0 0 0 3px rgba(45, 156, 219, 0.15)`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = THEME.primaryBorder;
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            <div style={{ marginBottom: "28px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "500", fontSize: "14px", color: THEME.textDark }}>
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
                  width: "100%", padding: "12px 14px",
                  border: `1px solid ${THEME.primaryBorder}`, borderRadius: "8px",
                  fontSize: "14px", boxSizing: "border-box", outline: "none",
                  backgroundColor: THEME.white
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = THEME.primary;
                  e.target.style.boxShadow = `0 0 0 3px rgba(45, 156, 219, 0.15)`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = THEME.primaryBorder;
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              style={{
                width: "100%", padding: "14px",
                background: isLoggingIn
                  ? "#a8c8dc"
                  : `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.primaryDark} 100%)`,
                color: "white", border: "none", borderRadius: "8px",
                fontSize: "16px", fontWeight: "600",
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

  // ===== LOADING STATE (also waits for server time) =====
  if (isLoading || loadingTime) {
    return (
      <div style={{ width: "100%", padding: "60px 20px", textAlign: "center" }}>
        <div style={{
          width: "40px", height: "40px",
          border: `4px solid ${THEME.border}`,
          borderTop: `4px solid ${THEME.primary}`,
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
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
            <select
              value={selectedLabelSize}
              onChange={(e) => setSelectedLabelSize(e.target.value)}
              style={{
                padding: "5px 10px", border: `1px solid ${THEME.primaryBorder}`,
                borderRadius: "4px", fontSize: "12px",
                backgroundColor: THEME.white, cursor: "pointer", color: THEME.textDark
              }}
            >
              {LABEL_SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: "8px 20px", backgroundColor: THEME.primary,
              color: "white", border: "none", borderRadius: "4px",
              cursor: "pointer", fontSize: "14px", fontWeight: "500"
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.primaryDark; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.primary; }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ width: "100%", padding: "20px 24px", boxSizing: "border-box" }}>

        {/* ✅ NEW: CUT-OFF TIME BANNER */}
        {cutOffMessage && (
          <div style={{
            width: "100%",
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: isPastCutOff ? THEME.warningLight : THEME.primaryLight,
            border: `1px solid ${isPastCutOff ? THEME.warning : THEME.primaryBorder}`,
            borderRadius: "8px",
            color: isPastCutOff ? THEME.warning : THEME.textDark,
            fontSize: "13px",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "8px"
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
            <div style={{
              padding: "12px", backgroundColor: THEME.dangerLight,
              borderRadius: "4px", marginBottom: "16px", color: THEME.danger
            }}>
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
                const selectedCount = getSelectedOrderIds(group.orders).filter(id => !isOrderSent(id)).length;
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
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => handleSelectAll(groupKey, e.target.checked, group.orders)}
                          style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: THEME.primary }}
                        />
                        <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: THEME.textDark }}>
                          {getDateGroupName(groupKey)}
                          <span style={{ fontSize: "13px", fontWeight: "400", color: THEME.textMuted, marginLeft: "8px" }}>
                            ({group.orders.length} order{group.orders.length > 1 ? 's' : ''})
                          </span>
                          {selectedCount > 0 && (
                            <span style={{ fontSize: "12px", color: THEME.warning, marginLeft: "8px" }}>
                              • {selectedCount} selected
                            </span>
                          )}
                        </h4>
                      </div>
                      {selectedCount > 0 && (
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
                          {isBatchSending ? `⏳ Sending ${selectedCount}...` : `📤 Send Selected (${selectedCount})`}
                        </button>
                      )}
                    </div>

                    <div style={{ overflowX: "auto", width: "100%" }}>
                      <table style={{
                        width: "100%", borderCollapse: "collapse",
                        textAlign: "left", fontSize: "13px", minWidth: "1500px"
                      }}>
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

                            const fullAddress = [
                              addr.address1,
                              addr.address2,
                              addr.city,
                              addr.provinceCode,
                              addr.zip
                            ].filter(Boolean).join(', ') || 'N/A';

                            const fullName = addr.name || 'Guest';
                            const email = order.customer?.email || 'N/A';
                            const phone = addr.phone || 'N/A';
                            const itemCount = order.lineItems?.edges?.length || 0;

                            // Check if selected date is past cut-off (client-side check for UI)
                            const selectedDate = deliveryDates[orderId];
                            const isDateBlocked = !!(
                              selectedDate &&
                              dateInfo.isPastCutOff &&
                              selectedDate === dateInfo.tomorrow
                            );

                            const canSend = !sent && 
                                           validation.status !== 'invalid' && 
                                           validation.status !== 'checking' &&
                                           validation.status !== 'no-postcode' &&
                                           !isDateBlocked;

                            return (
                              <tr key={orderId || index}>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedOrders[orderId] || false}
                                    onChange={(e) => handleSelectOrder(orderId, e.target.checked)}
                                    disabled={sent || isSending || validation.status === 'invalid' || isDateBlocked}
                                    style={{ width: "15px", height: "15px", accentColor: THEME.primary }}
                                  />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <a
                                    href={`https://admin.shopify.com/apps/orders/${orderId?.split('/').pop()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: THEME.primary, textDecoration: "none", fontWeight: "600" }}
                                  >
                                    {order.name}
                                  </a>
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  {fullName}
                                  {hasEditedAddress && (
                                    <span style={{ marginLeft: "6px", fontSize: "10px", color: THEME.primary, fontWeight: "600" }}>
                                      (edited)
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px" }}>
                                  {email}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px" }}>
                                  {phone}
                                </td>
                                <td style={{
                                  padding: "10px 6px",
                                  borderBottom: `1px solid ${THEME.border}`,
                                  fontSize: "12px",
                                  maxWidth: "240px",
                                  position: "relative"
                                }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
                                    <div style={{ flex: 1, wordBreak: "break-word" }}>{fullAddress}</div>
                                    <button
                                      onClick={() => openEditModal(order)}
                                      disabled={sent}
                                      title={sent ? "Cannot edit — order already sent" : "Edit address"}
                                      style={{
                                        padding: "2px",
                                        background: "none",
                                        border: `1px solid ${THEME.primaryBorder}`,
                                        borderRadius: "4px",
                                        cursor: sent ? "not-allowed" : "pointer",
                                        color: THEME.primary,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                        opacity: sent ? 0.4 : 1,
                                        transition: "all 0.15s"
                                      }}
                                      onMouseEnter={(e) => {
                                        if (!sent) {
                                          e.currentTarget.style.backgroundColor = THEME.primaryLight;
                                          e.currentTarget.style.borderColor = THEME.primary;
                                        }
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                        e.currentTarget.style.borderColor = THEME.primaryBorder;
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontSize: "12px" }}>
                                  {itemCount} items
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, fontWeight: "600", fontSize: "12px" }}>
                                  {order.totalPriceSet?.shopMoney?.amount || '0.00'} {order.totalPriceSet?.shopMoney?.currencyCode || 'USD'}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <input
                                    type="date"
                                    value={deliveryDates[orderId] || ''}
                                    min={minAllowedDate}
                                    onChange={(e) => updateDeliveryDate(orderId, e.target.value)}
                                    style={{
                                      padding: "5px 6px",
                                      border: `1px solid ${
                                        isDateBlocked || validation.status === 'invalid' 
                                          ? THEME.danger 
                                          : THEME.primaryBorder
                                      }`,
                                      borderRadius: "4px", fontSize: "12px",
                                      width: "130px", color: THEME.textDark,
                                      backgroundColor: isDateBlocked ? THEME.dangerLight : THEME.white
                                    }}
                                    disabled={sent || isSending}
                                  />
                                  {isDateBlocked && !sent && (
                                    <div style={{
                                      fontSize: "10px",
                                      color: THEME.danger,
                                      marginTop: "3px",
                                      fontWeight: "600"
                                    }}>
                                      ⏰ Past 4 PM — not available
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={boxCounts[orderId] || 1}
                                    onChange={(e) => updateBoxCount(orderId, parseInt(e.target.value) || 1)}
                                    style={{
                                      padding: "5px 6px",
                                      border: `1px solid ${THEME.primaryBorder}`,
                                      borderRadius: "4px", fontSize: "12px",
                                      width: "55px", color: THEME.textDark,
                                      backgroundColor: THEME.white
                                    }}
                                    disabled={sent || isSending}
                                  />
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}`, minWidth: "200px" }}>
                                  {sent ? (
                                    <span style={{ fontSize: "11px", color: THEME.textMuted }}>
                                      — (already sent)
                                    </span>
                                  ) : validation.status === 'checking' ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: THEME.textMuted }}>
                                      <div style={{
                                        width: "12px", height: "12px",
                                        border: `2px solid ${THEME.border}`,
                                        borderTop: `2px solid ${THEME.primary}`,
                                        borderRadius: "50%",
                                        animation: "spin 1s linear infinite"
                                      }} />
                                      Checking...
                                    </div>
                                  ) : validation.status === 'valid' ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                      <span style={{
                                        display: "inline-block", padding: "3px 8px",
                                        backgroundColor: THEME.successLight, color: THEME.success,
                                        border: `1px solid ${THEME.success}`, borderRadius: "4px",
                                        fontSize: "11px", fontWeight: "600"
                                      }}>
                                        ✅ Deliverable
                                      </span>
                                      {validation.suburb && (
                                        <div style={{ fontSize: "10px", color: THEME.textMuted }}>
                                          {validation.suburb}{validation.run ? ` • ${validation.run}` : ''}
                                        </div>
                                      )}
                                    </div>
                                  ) : validation.status === 'invalid' ? (
                                    <div style={{
                                      display: "flex", flexDirection: "column", gap: "3px",
                                      padding: "6px 8px", backgroundColor: THEME.dangerLight,
                                      border: `1px solid ${THEME.dangerBorder}`, borderRadius: "4px"
                                    }}>
                                      <span style={{ fontSize: "11px", fontWeight: "600", color: THEME.danger }}>
                                        ❌ Not Deliverable
                                      </span>
                                      {validation.suburb && (
                                        <div style={{ fontSize: "10px", color: THEME.textMuted }}>
                                          {validation.suburb}{validation.run ? ` • ${validation.run}` : ''}
                                        </div>
                                      )}
                                      <div style={{ fontSize: "10px", color: THEME.danger }}>
                                        {validation.message}
                                      </div>
                                      {validation.nextAvailableDay && (
                                        <div style={{ fontSize: "10px", color: THEME.success, fontWeight: "600" }}>
                                          ✅ Next: {validation.nextAvailableDay}
                                          {validation.nextAvailableDate ? ` (${validation.nextAvailableDate})` : ''}
                                        </div>
                                      )}
                                    </div>
                                  ) : validation.status === 'no-postcode' ? (
                                    <span style={{ fontSize: "11px", color: THEME.danger }}>
                                      ⚠️ No postcode in order
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: "11px", color: THEME.textMuted }}>
                                      Waiting...
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "10px 6px", borderBottom: `1px solid ${THEME.border}` }}>
                                  {sent ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <span style={{
                                        display: "inline-block", padding: "5px 12px",
                                        backgroundColor: THEME.successLight, color: THEME.success,
                                        border: `1px solid ${THEME.success}`, borderRadius: "4px",
                                        fontSize: "12px", fontWeight: "600",
                                        whiteSpace: "nowrap", textAlign: "center"
                                      }}>
                                        ✅ Sent
                                      </span>
                                      <div style={{ fontSize: "9px", color: THEME.textMuted, textAlign: "center" }}>
                                        DO: {sentDetails?.doNumber || "N/A"}
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <button
                                        onClick={() => sendToMealCart(order)}
                                        disabled={isSending || !canSend}
                                        title={
                                          isDateBlocked
                                            ? "Tomorrow is not available — it's past 4 PM AEST"
                                            : validation.status === 'invalid' 
                                            ? `Cannot send: ${validation.message}`
                                            : validation.status === 'checking'
                                            ? "Please wait — validating postcode"
                                            : !canSend
                                            ? "Cannot send this order"
                                            : "Send to MealCart"
                                        }
                                        style={{
                                          padding: "5px 12px",
                                          backgroundColor: !canSend 
                                            ? "#ccc" 
                                            : isError 
                                            ? THEME.danger 
                                            : THEME.primary,
                                          color: "white", border: "none",
                                          borderRadius: "4px",
                                          cursor: (!canSend || isSending) ? "not-allowed" : "pointer",
                                          fontSize: "12px", fontWeight: "500",
                                          whiteSpace: "nowrap",
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
                                        <div style={{
                                          fontSize: "10px",
                                          color: isError ? THEME.danger : THEME.textMuted,
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

      {/* ===== ADDRESS EDIT MODAL ===== */}
      {editingOrder && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: "20px", boxSizing: "border-box"
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelEdit();
          }}
        >
          <div style={{
            backgroundColor: THEME.white,
            borderRadius: "12px",
            padding: "28px",
            maxWidth: "600px",
            maxHeight: "90vh",
            overflow: "auto",
            width: "100%",
            position: "relative",
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
              <button
                onClick={cancelEdit}
                style={{
                  background: "none", border: "none",
                  fontSize: "24px", cursor: "pointer",
                  color: THEME.textMuted, padding: 0,
                  width: "32px", height: "32px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "4px"
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.primaryLight; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                ×
              </button>
            </div>

            <div style={{
              padding: "10px 14px",
              backgroundColor: THEME.primaryLight,
              border: `1px solid ${THEME.primaryBorder}`,
              borderRadius: "8px",
              marginBottom: "20px",
              fontSize: "12px",
              color: THEME.textDark
            }}>
              💡 This edits the address for <strong>this delivery only</strong>. It will not update the original Shopify order.
            </div>

            <div style={{ display: "grid", gap: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
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

              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="0412 345 678"
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

              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                  Address Line 1
                </label>
                <input
                  type="text"
                  value={editForm.address1}
                  onChange={(e) => setEditForm(prev => ({ ...prev, address1: e.target.value }))}
                  placeholder="123 Main St"
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

              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                  Address Line 2 <span style={{ color: THEME.textMuted, fontWeight: "400" }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={editForm.address2}
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
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                    City
                  </label>
                  <input
                    type="text"
                    value={editForm.city}
                    onChange={(e) => setEditForm(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="Melbourne"
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
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                    State
                  </label>
                  <select
                    value={editForm.provinceCode}
                    onChange={(e) => setEditForm(prev => ({ ...prev, provinceCode: e.target.value }))}
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: `1px solid ${THEME.primaryBorder}`,
                      borderRadius: "8px", fontSize: "14px",
                      boxSizing: "border-box", outline: "none",
                      backgroundColor: THEME.white, color: THEME.textDark,
                      cursor: "pointer"
                    }}
                  >
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
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                    Postcode
                  </label>
                  <input
                    type="text"
                    value={editForm.zip}
                    onChange={(e) => setEditForm(prev => ({ ...prev, zip: e.target.value }))}
                    placeholder="3000"
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
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: THEME.textDark }}>
                    Country
                  </label>
                  <input
                    type="text"
                    value={editForm.country}
                    onChange={(e) => setEditForm(prev => ({ ...prev, country: e.target.value }))}
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
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "24px" }}>
              <button
                onClick={cancelEdit}
                disabled={editSaving}
                style={{
                  padding: "10px 20px",
                  backgroundColor: THEME.white,
                  color: THEME.textDark,
                  border: `1px solid ${THEME.primaryBorder}`,
                  borderRadius: "8px",
                  cursor: editSaving ? "not-allowed" : "pointer",
                  fontSize: "14px", fontWeight: "500"
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveEditedAddress}
                disabled={editSaving}
                style={{
                  padding: "10px 20px",
                  background: editSaving
                    ? "#a8c8dc"
                    : `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.primaryDark} 100%)`,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
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