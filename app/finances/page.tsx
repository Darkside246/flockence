"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";

const initialDate = new Date().toISOString().slice(0, 10);
const money = (n: number) => new Intl.NumberFormat("en-BB", { style: "currency", currency: "BBD" }).format(n / 100);

type Batch = { id: string; name: string };
type Expense = { id: string; description: string; category: string; date: string; amountMinor: number };
type Order = { id:string; customerName:string|null; totalMinor:number; orderStatus:string; fulfillmentMethod:string|null; deliveryAddress:string|null; date:string; source:string; items:{description:string;quantity:number}[] };
type ApiResponse = { ok: boolean; data: any; error?: string };

async function readJson(response: Response): Promise<ApiResponse> {
  const text = await response.text();
  if (!text.trim()) return { ok: response.ok, data: null, error: response.ok ? undefined : `Request failed (${response.status})` };
  try {
    const data = JSON.parse(text);
    return { ok: response.ok, data, error: data?.error };
  } catch {
    return { ok: false, data: null, error: `Server returned an invalid response (${response.status}).` };
  }
}

export default function Finances() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [feed, setFeed] = useState({ date: initialDate, feedType: "Broiler feed", bagSizeKg: "30", quantityBags: "", unitCost: "5600", batchId: "" });
  const [expense, setExpense] = useState({ date: initialDate, category: "Utilities", description: "", amount: "", batchId: "" });
  const [sale, setSale] = useState({ date: initialDate, customerName: "", description: "Whole chicken", quantity: "", unitPrice: "", amountPaid: "", batchId: "" });

  const load = useCallback(async () => {
    setStatus("");
    try {
      const [batchResponse, expenseResponse, orderResponse] = await Promise.all([fetch("/api/batches"), fetch("/api/expenses"), fetch("/api/orders")]);
      const [batchResult, expenseResult, orderResult] = await Promise.all([readJson(batchResponse), readJson(expenseResponse), readJson(orderResponse)]);
      if (!batchResult.ok) throw new Error(batchResult.error || "Unable to load batches.");
      if (!expenseResult.ok) throw new Error(expenseResult.error || "Unable to load expenses.");
      if (!orderResult.ok) throw new Error(orderResult.error || "Unable to load orders.");
      setBatches(Array.isArray(batchResult.data) ? batchResult.data : []);
      setExpenses(Array.isArray(expenseResult.data) ? expenseResult.data : []);
      setOrders(Array.isArray(orderResult.data) ? orderResult.data : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load financial data.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (url: string, body: unknown, successMessage: string) => {
    setStatus("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await readJson(response);
      if (!result.ok) throw new Error(result.error || `Request failed (${response.status}).`);
      setStatus(successMessage);
      await load();
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save record.");
      return false;
    }
  };

  const salePreview = useMemo(() => {
    const quantity = Number(sale.quantity) || 0;
    const price = Number(sale.unitPrice) || 0;
    return quantity * price;
  }, [sale.quantity, sale.unitPrice]);

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Finances</h1><p>Record costs and revenue without double counting.</p></div><span className="badge">BBD · OPERATIONS</span></div></header>
    <Nav />
    <main className="main">
      {status && <div className="section card notice-card" role="status"><strong>{status}</strong></div>}
      <section className="section grid2">
        <article className="card">
          <div className="section-head"><div><h3>Feed purchase</h3><p>Record incoming feed and optionally allocate it to a batch.</p></div><span className="pill">COST</span></div>
          <form className="form" onSubmit={async e => { e.preventDefault(); const saved = await submit("/api/feed", { ...feed, bagSizeKg: Number(feed.bagSizeKg), quantityBags: Number(feed.quantityBags), unitCostMinor: Number(feed.unitCost) }, "Feed purchase recorded."); if (saved) setFeed(v => ({ ...v, quantityBags: "" })); }}>
            <div className="grid2"><label>Date<input type="date" value={feed.date} onChange={e => setFeed({ ...feed, date: e.target.value })} /></label><label>Feed type<input value={feed.feedType} onChange={e => setFeed({ ...feed, feedType: e.target.value })} /></label><label>Bag size (kg)<input type="number" min="0.001" step="0.001" value={feed.bagSizeKg} onChange={e => setFeed({ ...feed, bagSizeKg: e.target.value })} required /></label><label>Number of bags<input type="number" min="0.001" step="0.001" value={feed.quantityBags} onChange={e => setFeed({ ...feed, quantityBags: e.target.value })} required /></label><label>Cost per bag (BBD)<input type="number" min="0" step="0.01" value={Number(feed.unitCost) / 100} onChange={e => setFeed({ ...feed, unitCost: String(Math.round(Number(e.target.value) * 100)) })} required /></label><label>Batch allocation<select value={feed.batchId} onChange={e => setFeed({ ...feed, batchId: e.target.value })}><option value="">Farm-wide purchase</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
            <button className="button button-primary" type="submit">Save feed purchase</button>
          </form>
        </article>
        <article className="card">
          <div className="section-head"><div><h3>Add expense</h3><p>Capture actual farm costs with optional batch allocation.</p></div><span className="pill">EXPENSE</span></div>
          <form className="form" onSubmit={async e => { e.preventDefault(); const saved = await submit("/api/expenses", { ...expense, amountMinor: Math.round(Number(expense.amount) * 100) }, "Expense recorded."); if (saved) setExpense(v => ({ ...v, description: "", amount: "" })); }}>
            <div className="grid2"><label>Date<input type="date" value={expense.date} onChange={e => setExpense({ ...expense, date: e.target.value })} /></label><label>Category<select value={expense.category} onChange={e => setExpense({ ...expense, category: e.target.value })}><option>Utilities</option><option>Medicine</option><option>Bedding</option><option>Slaughter</option><option>Labor</option><option>Transport</option><option>Other</option></select></label><label>Description<input value={expense.description} onChange={e => setExpense({ ...expense, description: e.target.value })} required /></label><label>Amount (BBD)<input type="number" min="0" step="0.01" value={expense.amount} onChange={e => setExpense({ ...expense, amount: e.target.value })} required /></label><label>Batch allocation<select value={expense.batchId} onChange={e => setExpense({ ...expense, batchId: e.target.value })}><option value="">Farm-wide overhead</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
            <button className="button button-primary" type="submit">Save expense</button>
          </form>
        </article>
      </section>
      <section className="section card" id="sale">
        <div className="section-head"><div><h3>Chicken sold</h3><p>Record revenue. The server remains the source of truth for sale totals.</p></div><span className="pill">REVENUE</span></div>
        <form className="form" onSubmit={async e => {
          e.preventDefault();
          const q = Number(sale.quantity);
          const p = Math.round(Number(sale.unitPrice) * 100);
          const amountReceivedBbd = sale.amountPaid.trim() ? Number(sale.amountPaid) : q * Number(sale.unitPrice);
          const saved = await submit("/api/sales", { date: sale.date, customerName: sale.customerName, amountPaidMinor: Math.round(amountReceivedBbd * 100), items: [{ batchId: sale.batchId || null, description: sale.description, quantity: q, unitPriceMinor: p, totalMinor: Math.round(q * p) }] }, "Sale recorded.");
          if (saved) setSale(v => ({ ...v, quantity: "", unitPrice: "", amountPaid: "" }));
        }}>
          <div className="grid2"><label>Date<input type="date" value={sale.date} onChange={e => setSale({ ...sale, date: e.target.value })} /></label><label>Customer<input value={sale.customerName} onChange={e => setSale({ ...sale, customerName: e.target.value })} /></label><label>Product<input value={sale.description} onChange={e => setSale({ ...sale, description: e.target.value })} /></label><label>Quantity<input type="number" min="0.001" step="0.001" value={sale.quantity} onChange={e => setSale({ ...sale, quantity: e.target.value })} required /></label><label>Price each (BBD)<input type="number" min="0" step="0.01" value={sale.unitPrice} onChange={e => setSale({ ...sale, unitPrice: e.target.value })} required /></label><label>Amount received (BBD)<input type="number" min="0" step="0.01" value={sale.amountPaid} onChange={e => setSale({ ...sale, amountPaid: e.target.value })} /></label><label>Batch<select value={sale.batchId} onChange={e => setSale({ ...sale, batchId: e.target.value })}><option value="">Not assigned</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
          <div className="stats"><div><span>Sale preview</span><strong>{money(Math.round(salePreview * 100))}</strong></div><div><span>Status</span><strong>Actual</strong></div><div><span>Currency</span><strong>BBD</strong></div><div><span>Inventory check</span><strong>Server-side</strong></div></div>
          <button className="button button-primary" type="submit">Record sale</button>
        </form>
      </section>
      <section className="section card"><div className="section-head"><div><h3>WhatsApp orders</h3><p>Orders created through AURA and any other order workflow can be advanced here. Customers see only the current status.</p></div><span className="badge">{orders.length} OPEN</span></div>{orders.length===0?<div className="empty"><strong>No open orders.</strong><span>New WhatsApp orders will appear here when AURA confirms them.</span></div>:<div className="list">{orders.map(order=><div className="card row" key={order.id}><div><strong>{order.customerName||"Customer"} · {money(order.totalMinor)}</strong><span>{order.items.map(i=>`${i.quantity} × ${i.description}`).join(", ")} · {order.fulfillmentMethod||"Pickup"}</span></div><select value={order.orderStatus} onChange={async e=>{const response=await fetch("/api/orders",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:order.id,orderStatus:e.target.value})});if(response.ok){setStatus("Order status updated.");await load();}else{const result=await readJson(response);setStatus(result.error||"Could not update order.");}}}><option value="CONFIRMED">Confirmed</option><option value="PREPARING">Preparing</option><option value="READY">Ready</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>)}</div>}</section>
      <section className="section"><div className="section-head"><div><h3>Recent expenses</h3><p>Latest recorded farm costs.</p></div><span className="badge">{expenses.length} RECORDS</span></div>{expenses.length === 0 ? <div className="card empty"><strong>No data recorded.</strong><span>Expenses you record will appear here.</span></div> : <div className="list">{expenses.map(x => <div className="card row" key={x.id}><div><strong>{x.description}</strong><span>{x.category} · {new Date(x.date).toLocaleDateString()}</span></div><strong>{money(x.amountMinor)}</strong></div>)}</div>}</section>
    </main>
  </div>;
}
