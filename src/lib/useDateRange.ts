"use client";

import { useState } from "react";

// months = calendar months to look back; 999 = "All"; negative = days to look back
export const RANGES: [string, number][] = [
  ["1M", 1], ["3M", 3], ["6M", 6], ["1Y", 12], ["3Y", 36], ["All", 999],
];

// Extended ranges with short-term day-granularity presets for the daily portfolio chart
export const RANGES_DAILY: [string, number][] = [
  ["1D", -1], ["1W", -7],
  ...RANGES,
];

export const DEFAULT_N = 12; // 1Y

export interface DateRange {
  startDate: string;
  endDate: string;
  minDate: string;
  maxDate: string;
  activePreset: number;   // index into the supplied ranges array, or -1 for custom
  showCustom: boolean;
  selectPreset: (n: number) => void;
  handleStartChange: (v: string) => void;
  handleEndChange: (v: string) => void;
  toggleCustom: () => void;
}

/**
 * Returns the start date for a given lookback, anchored to maxDate (the last data point)
 * so ranges stay meaningful when data lags behind today.
 * - n < 0  → day-based:   maxDate + n days, returns "YYYY-MM-DD"
 * - n ≥ 999 → return minDate as-is
 * - n ≥ 0  → month-based: n months before maxDate, returns "YYYY-MM"
 */
function calendarStart(n: number, minDate: string, maxDate: string): string {
  if (n >= 999) return minDate;
  // Parse maxDate — accept both "YYYY-MM" and "YYYY-MM-DD"
  const ref = new Date((maxDate.length === 7 ? maxDate + "-15" : maxDate) + "T00:00:00Z");
  if (n < 0) {
    ref.setUTCDate(ref.getUTCDate() + n);  // n is negative → goes back
    const ymd = ref.toISOString().slice(0, 10);
    return ymd < minDate ? minDate : ymd;
  }
  ref.setUTCMonth(ref.getUTCMonth() - n);
  const ym = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`;
  return ym < minDate ? minDate : ym;
}

export function useDateRange(
  labels: string[],
  ranges: [string, number][] = RANGES,
  defaultN = DEFAULT_N
): DateRange {
  const minDate = labels[0] ?? new Date().toISOString().slice(0, 7);
  const maxDate = labels[labels.length - 1] ?? new Date().toISOString().slice(0, 7);

  const [startDate, setStartDate] = useState(() => calendarStart(defaultN, minDate, maxDate));
  const [endDate,   setEndDate]   = useState(maxDate);
  const [showCustom, setShowCustom] = useState(false);
  // Track selected preset by index to avoid ambiguity when multiple presets map to the same date
  const [activePreset, setActivePreset] = useState(
    () => ranges.findIndex(([, n]) => n === defaultN)
  );

  function selectPreset(n: number) {
    const idx = ranges.findIndex(([, pn]) => pn === n);
    setActivePreset(idx >= 0 ? idx : -1);
    setStartDate(calendarStart(n, minDate, maxDate));
    setEndDate(maxDate);
    setShowCustom(false);
  }

  function handleStartChange(v: string) {
    setActivePreset(-1);
    setStartDate(v);
    if (v > endDate) setEndDate(v);
  }

  function handleEndChange(v: string) {
    setActivePreset(-1);
    setEndDate(v);
    if (v < startDate) setStartDate(v);
  }

  return {
    startDate, endDate, minDate, maxDate,
    activePreset, showCustom,
    selectPreset, handleStartChange, handleEndChange,
    toggleCustom: () => setShowCustom((v) => !v),
  };
}
