"use client";
import { Nav } from "@/components/nav";
import { FoodSafetyChecklist } from "@/components/food-safety-checklist";

export default function FoodSafety() {
  return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Food safety and biosecurity</h1><p>Complete the checklist that keeps birds, eggs and meat safe to sell.</p></div></div></header><Nav /><main className="main"><FoodSafetyChecklist /></main></div>;
}
