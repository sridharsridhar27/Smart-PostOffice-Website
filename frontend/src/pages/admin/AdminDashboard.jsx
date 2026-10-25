import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { STATUS_LABELS } from "../../utils/parcelStatus";
import { formatDateTime, timeAgo } from "../../utils/format";

const REFRESH_MS = 30000;

const cronText = (expr) => {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(expr || "");
  if (m) return `Every ${m[1]} minutes`;
  if (expr === "0 * * * *") return "Every hour";
  return expr;
};

const hoursText = (h) => (h >= 1 ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.round(h * 60)} minutes`);

function StatCard({ label, value, sub, color = "text-slate-800" }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function AlertCard({ to, label, value, hint, tone }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
    slate: "border-slate-200 bg-white text-slate-700",
  };
  const style = value > 0 ? tones[tone] : tones.slate;
  return (
    <Link to={to} className={`block rounded-xl border p-4 transition hover:shadow-md ${style}`}>
      <p className="text-xs font-medium uppercase opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="text-xs opacity-80">{hint}</p>
    </Link>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [dash, status] = await Promise.all([
        api.get("/admin/dashboard"),
        api.get("/admin/jobs/auto-book/status"),
      ]);
      setData(dash.data);
      setJob(status.data);
      setLastUpdated(new Date());
      setError("");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const runAutoBook = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post("/admin/jobs/auto-book/run");
      setRunResult({ ok: true, ...res.data });
      await load();
    } catch (err) {
      setRunResult({ ok: false, message: getErrorMessage(err) });
    } finally {
      setRunning(false);
    }
  };

  if (!data) {
    return error ? (
      <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
    ) : (
      <p className="text-sm text-slate-500">Loading dashboard...</p>
    );
  }

  const t = data.today;
  const maxSlot = Math.max(1, ...data.slotsToday.map((s) => s.count));
  const pipelineTotal = Object.values(data.pipeline).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Welcome, {user?.name}</h2>
          <p className="text-sm text-slate-500">{data.dateLabel} · Post office overview</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Live · updated {lastUpdated ? timeAgo(lastUpdated) : "-"}
          </span>
          <button onClick={load} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50">
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Today */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase text-slate-500">Today</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Parcels Arrived" value={t.arrived} />
          <StatCard label="Slots Booked" value={`${t.slotsBooked}/${t.capacity}`} sub="booked / capacity" />
          <StatCard label="Assigned" value={t.assigned} color="text-indigo-700" sub={t.waitingAssignment ? `${t.waitingAssignment} waiting` : null} />
          <StatCard label="Out for Delivery" value={t.outForDelivery} color="text-purple-700" />
          <StatCard label="Delivered" value={t.delivered} color="text-green-700" />
          <StatCard label="Failed Attempts" value={t.failed} color="text-red-700" />
        </div>
      </div>

      {/* Alerts */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase text-slate-500">Needs Attention</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AlertCard
            to="/admin/parcels?status=NOTIFIED"
            label="Awaiting Slot Booking"
            value={data.alerts.awaitingBooking}
            hint="Customers notified, no slot yet"
            tone="amber"
          />
          <AlertCard
            to="/admin/parcels?status=NOTIFIED"
            label="Due for Auto-Booking"
            value={data.alerts.autoBookDue}
            hint={`Waiting more than ${hoursText(data.alerts.autoBookAfterHours)}`}
            tone="indigo"
          />
          <AlertCard
            to="/admin/unassigned"
            label="Unassigned"
            value={data.alerts.unassigned}
            hint="Booked but no delivery person"
            tone="amber"
          />
          <AlertCard
            to="/admin/parcels?status=FAILED"
            label="Collect at Post Office"
            value={data.alerts.mustCollect}
            hint="3 delivery attempts failed"
            tone="red"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Slots today chart */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Today's Bookings by Slot</h3>
            <Link to="/admin/slot-bookings" className="text-xs font-medium text-red-700 hover:underline">
              View all →
            </Link>
          </div>
          <div className="flex h-44 items-end gap-2">
            {data.slotsToday.map((s) => (
              <div key={s.hour} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold">{s.count || ""}</span>
                <div
                  className={`w-full rounded-t ${s.count ? "bg-red-600" : "bg-slate-100"}`}
                  style={{ height: `${Math.max(4, (s.count / maxSlot) * 130)}px` }}
                  title={`${s.label}: ${s.count}`}
                />
                <span className="text-[10px] text-slate-500">{s.label.split(" - ")[0].replace(":00", "")}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Parcel Pipeline</h3>
            <span className="text-xs text-slate-500">{pipelineTotal} total</span>
          </div>
          <ul className="space-y-2">
            {Object.entries(data.pipeline).map(([status, count]) => (
              <li key={status}>
                <Link
                  to={`/admin/parcels?status=${status}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50"
                >
                  <StatusBadge status={status} />
                  <div className="flex items-center gap-3">
                    <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-slate-100 sm:block">
                      <div
                        className="h-full bg-slate-400"
                        style={{ width: `${pipelineTotal ? (count / pipelineTotal) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-semibold">{count}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Workload */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Delivery Partners Today</h3>
            <Link to="/admin/assignments" className="text-xs font-medium text-red-700 hover:underline">
              Details →
            </Link>
          </div>
          {data.workload.length === 0 ? (
            <p className="text-sm text-slate-500">No active delivery persons.</p>
          ) : (
            <ul className="space-y-3">
              {data.workload.map((dp) => (
                <li key={dp.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      <span className="font-medium">{dp.name}</span>
                      <span className="text-xs text-slate-500"> · {dp.homeArea || "-"}</span>
                    </span>
                    <span className="font-semibold">
                      {dp.load}/{dp.capacity}
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="bg-green-500" style={{ width: `${(dp.delivered / dp.capacity) * 100}%` }} />
                    <div className="bg-purple-500" style={{ width: `${(dp.outForDelivery / dp.capacity) * 100}%` }} />
                    <div className="bg-indigo-400" style={{ width: `${(dp.assigned / dp.capacity) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />Delivered</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" />On the way</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-400" />To start</span>
          </div>
        </div>

        {/* AI stats */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold">🤖 AI Assignment</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-indigo-50 p-3">
              <p className="text-xs text-indigo-700">Assigned by AI</p>
              <p className="text-2xl font-bold text-indigo-800">{data.ai.aiRate}%</p>
              <p className="text-xs text-indigo-600">
                {data.ai.aiAssignments} AI · {data.ai.manualAssignments} manual
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-600">Average AI score</p>
              <p className="text-2xl font-bold">{data.ai.averageScore}</p>
              <p className="text-xs text-slate-500">higher = better grouping</p>
            </div>
            <div className="col-span-2 rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-600">Slots auto-booked (no booking in time)</p>
              <p className="text-xl font-bold">{data.ai.autoBookedSlots}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Auto-booking job */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-1 font-semibold">⏰ Auto-Booking Job</h3>
          {job && (
            <>
              <p className="text-sm text-slate-500">
                Books a slot automatically when a customer hasn't booked within{" "}
                <b>{hoursText(job.afterHours)}</b> · {cronText(job.schedule)}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-indigo-50 p-3">
                  <p className="text-xs text-indigo-700">Due now</p>
                  <p className="text-xl font-bold text-indigo-800">{job.dueNow}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-600">Due in next 6 hours</p>
                  <p className="text-xl font-bold">{job.dueWithin6h}</p>
                </div>
              </div>

              <div className="mt-3 rounded-lg border p-3 text-sm">
                <p className="text-xs font-medium uppercase text-slate-500">Last run</p>
                {job.lastRun ? (
                  <>
                    <p className="mt-1">
                      {formatDateTime(job.lastRun.finishedAt)} <span className="text-slate-500">· {job.lastRun.trigger}</span>
                    </p>
                    <p className="text-slate-600">
                      Checked {job.lastRun.checked} · Booked {job.lastRun.booked} · AI assigned {job.lastRun.assigned}
                      {job.lastRun.noCapacity ? ` · No capacity ${job.lastRun.noCapacity}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-slate-500">Not run yet since server start</p>
                )}
              </div>

              <button
                onClick={runAutoBook}
                disabled={running || job.running}
                className="mt-4 w-full rounded-md bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {running || job.running ? "Running..." : "▶ Run auto-booking now"}
              </button>

              {runResult && (
                <div
                  className={`mt-3 rounded-md px-3 py-2 text-sm ${
                    runResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
                  }`}
                >
                  <p className="font-medium">{runResult.message}</p>
                  {runResult.ok && runResult.result.parcels.length > 0 && (
                    <ul className="mt-1 space-y-0.5 font-mono text-xs">
                      {runResult.result.parcels.map((p) => (
                        <li key={p.trackingNumber}>
                          {p.trackingNumber} → {p.slot} → {p.deliveryPerson || "unassigned"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Recent activity */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold">Recent Activity</h3>
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <div className="min-w-0">
                    <p>
                      <Link to={`/admin/parcels/${a.parcel.id}`} className="font-mono font-medium text-red-700 hover:underline">
                        {a.parcel.trackingNumber}
                      </Link>{" "}
                      · <span className="font-medium">{STATUS_LABELS[a.status]}</span>
                    </p>
                    {a.note && <p className="truncate text-slate-600">{a.note}</p>}
                    <p className="text-xs text-slate-400">
                      {timeAgo(a.createdAt)} · {a.changedBy ? a.changedBy.name : "System"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}