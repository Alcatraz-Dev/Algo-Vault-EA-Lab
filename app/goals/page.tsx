"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, Plus, Target, CheckCircle, Clock, Trash2, X, TrendingUp,
    ArrowLeft, Trophy, Flame, CalendarDays, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type TradingGoal = {
    id: string; type: string; title: string; target: number; current: number; unit: string; deadline: number; achieved: boolean; createdAt: number;
};

function currentTimestamp(): number {
    return Date.now();
}

const GOAL_TYPES = [
    { value: "monthly_pnl", label: "Monthly P/L", unit: "$", icon: TrendingUp },
    { value: "win_rate", label: "Win Rate", unit: "%", icon: Target },
    { value: "trade_count", label: "Trade Count", unit: "trades", icon: Flame },
    { value: "max_drawdown", label: "Max Drawdown", unit: "%", icon: TrendingUp },
    { value: "profit_factor", label: "Profit Factor", unit: "", icon: Trophy },
    { value: "risk_reward", label: "Avg Risk:Reward", unit: "", icon: Target },
    { value: "custom", label: "Custom Goal", unit: "", icon: Target },
];

function GoalCard({ goal, onUpdate, onDelete }: { goal: TradingGoal; onUpdate: (id: string, val: number) => void; onDelete: (id: string) => void }) {
    const [editValue, setEditValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const progress = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;
    const daysLeft = Math.max(0, Math.ceil((goal.deadline - currentTimestamp()) / (1000 * 60 * 60 * 24)));
    const typeInfo = GOAL_TYPES.find((t) => t.value === goal.type);
    const TypeIcon = typeInfo?.icon || Target;

    const circumference = 2 * Math.PI * 36;
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    return (
        <div className={cn(
            "group relative rounded-lg border p-6 transition-all duration-200",
            goal.achieved
                ? "border-positive/20 bg-positive-muted shadow-lg "
                : "border-border/30 bg-muted/50 hover:border-border/20 hover:bg-muted"
        )}>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                        goal.achieved ? "bg-positive/20" : "bg-primary/10"
                    )}>
                        {goal.achieved ? <CheckCircle size={20} className="text-positive" /> : <TypeIcon size={20} className="text-primary" />}
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">{goal.title}</h3>
                        <p className="mt-0.5 text-micro text-muted-foreground">{typeInfo?.label || goal.type}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => onDelete(goal.id)}
                    className="rounded-lg p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-negative hover:bg-negative/10 transition-all"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            {/* Progress Ring + Stats */}
            <div className="flex items-center gap-6 mb-4">
                <div className="relative flex-shrink-0">
                    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="4" className="text-foreground/[0.05]" />
                        <circle
                            cx="40" cy="40" r="36" fill="none"
                            stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            className={cn("transition-all duration-500", goal.achieved ? "text-positive" : progress >= 50 ? "text-warning" : "text-primary")}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={cn("text-lg font-bold font-numeric leading-none", goal.achieved ? "text-positive" : "text-foreground")}>
                            {progress.toFixed(0)}%
                        </span>
                    </div>
                </div>

                <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-micro text-muted-foreground">Progress</span>
                        <span className="font-numeric text-xs text-muted-foreground">
                            {goal.current.toLocaleString()} / {goal.target.toLocaleString()} {goal.unit}
                        </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted/30">
                        <div
                            className={cn("h-full rounded-full transition-all duration-500", goal.achieved ? "bg-positive" : progress >= 50 ? "bg-warning" : "bg-primary")}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-micro text-muted-foreground">
                            <CalendarDays size={10} />
                            {daysLeft === 0 ? "Due today" : `${daysLeft}d remaining`}
                        </span>
                        {goal.achieved && (
                            <span className="flex items-center gap-1 text-micro text-positive">
                                <CheckCircle size={10} /> Achieved
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Update Input */}
            {!goal.achieved && (
                <div className="flex items-center gap-2 pt-3 border-t border-border/20">
                    <div className="relative flex-1">
                        <Pencil size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            ref={inputRef}
                            type="number"
                            step="any"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && editValue) { onUpdate(goal.id, Number(editValue)); setEditValue(""); } }}
                            placeholder="Update value..."
                            className="w-full rounded-lg border border-border/40 bg-muted pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => { if (editValue) { onUpdate(goal.id, Number(editValue)); setEditValue(""); } }}
                        disabled={!editValue}
                        className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-foreground hover:bg-primary transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Update
                    </button>
                </div>
            )}
        </div>
    );
}

export default function GoalsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [goals, setGoals] = useState<TradingGoal[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);

    const [formTitle, setFormTitle] = useState("");
    const [formType, setFormType] = useState("monthly_pnl");
    const [formTarget, setFormTarget] = useState("");
    const [formUnit, setFormUnit] = useState("$");
    const [formDeadline, setFormDeadline] = useState("");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchGoals = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/goals", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setGoals(json.goals || []);
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchGoals()); }, [user, fetchGoals]);

    const createGoal = async () => {
        if (!user || !formTitle || !formTarget) return;
        setCreating(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/goals", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: formTitle, type: formType, target: Number(formTarget),
                    unit: formUnit, deadline: formDeadline ? new Date(formDeadline).getTime() : undefined,
                }),
            });
            setShowCreate(false); setFormTitle(""); setFormTarget(""); setFormDeadline("");
            fetchGoals();
        } catch {} finally { setCreating(false); }
    };

    const updateGoal = async (goalId: string, current: number) => {
        if (!user) return;
        const goal = goals.find((g) => g.id === goalId);
        if (!goal) return;
        const achieved = current >= goal.target;
        const token = await user.getIdToken();
        await fetch("/api/goals", {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ goalId, current, achieved }),
        });
        fetchGoals();
    };

    const deleteGoal = async (goalId: string) => {
        if (!user || !confirm("Delete this goal?")) return;
        const token = await user.getIdToken();
        await fetch("/api/goals", {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ goalId }),
        });
        fetchGoals();
    };

    if (authLoading) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Shield size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <Link href="/login" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-primary transition">
                        Sign In
                    </Link>
                </div>
            </div>
        );
    }

    const achievedCount = goals.filter((g) => g.achieved).length;
    const inProgressCount = goals.filter((g) => !g.achieved).length;
    const avgProgress = goals.length > 0
        ? goals.reduce((sum, g) => sum + (g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0), 0) / goals.length
        : 0;

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-warning/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-warning/10 hidden" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-info/10 hidden" />
            </div>
            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="mb-8">
                    <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                        <ArrowLeft size={12} /> Back to Account
                    </Link>
                    <div className="flex items-center justify-between" data-guide="page-header">
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Trading Goals</h1>
                            <p className="mt-1.5 text-sm text-muted-foreground">Set targets, track progress, and achieve consistency</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowCreate(true)}
                            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-foreground shadow-lg  hover:from-primary hover:to-info transition-all"
                        >
                            <Plus size={16} /> New Goal
                        </button>
                    </div>
                </div>

                {/* Stats Row */}
                <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4" data-guide="stats">
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                                <Target size={14} className="text-primary" />
                            </div>
                            <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
                        </div>
                        <p className="text-2xl font-bold font-numeric text-foreground">{goals.length}</p>
                    </div>
                    <div className="rounded-lg border border-positive/10 bg-positive/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-positive/10">
                                <CheckCircle size={14} className="text-positive" />
                            </div>
                            <span className="text-micro font-semibold uppercase tracking-wider text-positive/60">Achieved</span>
                        </div>
                        <p className="text-2xl font-bold font-numeric text-positive">{achievedCount}</p>
                    </div>
                    <div className="rounded-lg border border-warning/10 bg-warning/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
                                <Flame size={14} className="text-warning" />
                            </div>
                            <span className="text-micro font-semibold uppercase tracking-wider text-warning/60">In Progress</span>
                        </div>
                        <p className="text-2xl font-bold font-numeric text-warning">{inProgressCount}</p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10">
                                <TrendingUp size={14} className="text-info" />
                            </div>
                            <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Avg Progress</span>
                        </div>
                        <p className="text-2xl font-bold font-numeric text-foreground">{avgProgress.toFixed(0)}%</p>
                    </div>
                </div>

                {/* Create Modal */}
                {showCreate && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
                        <div className="w-full max-w-lg rounded-lg border border-border/40 bg-background p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-5">
                                <h2 className="text-lg font-semibold text-foreground">Create New Goal</h2>
                                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Goal Type</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {GOAL_TYPES.map((gt) => {
                                            const Icon = gt.icon;
                                            return (
                                                <button
                                                    key={gt.value}
                                                    type="button"
                                                    onClick={() => { setFormType(gt.value); setFormUnit(gt.unit); }}
                                                    className={cn(
                                                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
                                                        formType === gt.value
                                                            ? "border-primary/40 bg-primary/10 text-primary"
                                                            : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                                                    )}
                                                >
                                                    <Icon size={14} /> {gt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Title</label>
                                    <input
                                        type="text"
                                        value={formTitle}
                                        onChange={(e) => setFormTitle(e.target.value)}
                                        placeholder="e.g. Reach $5,000 profit this month"
                                        className="w-full rounded-lg border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Target</label>
                                        <input
                                            type="number"
                                            step="any"
                                            value={formTarget}
                                            onChange={(e) => setFormTarget(e.target.value)}
                                            placeholder="e.g. 500"
                                            className="w-full rounded-lg border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Deadline</label>
                                        <input
                                            type="date"
                                            value={formDeadline}
                                            onChange={(e) => setFormDeadline(e.target.value)}
                                            className="w-full rounded-lg border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none transition"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={createGoal}
                                    disabled={creating || !formTitle || !formTarget}
                                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-foreground hover:from-primary hover:to-info transition-all disabled:opacity-50"
                                >
                                    {creating ? <Loader2 size={15} className="animate-spin" /> : <Target size={15} />} Create Goal
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Goals Grid */}
                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : goals.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/40 p-16 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10">
                            <Target size={28} className="text-primary" />
                        </div>
                        <h3 className="mt-4 text-base font-semibold text-foreground">No goals yet</h3>
                        <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">
                            Start by creating your first trading goal. Track your progress and build consistency.
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowCreate(true)}
                            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-primary transition"
                        >
                            <Plus size={14} /> Create First Goal
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2">
                        {goals.map((goal) => (
                            <GoalCard key={goal.id} goal={goal} onUpdate={updateGoal} onDelete={deleteGoal} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
