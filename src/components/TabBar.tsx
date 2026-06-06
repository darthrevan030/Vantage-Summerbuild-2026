"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Overview", href: "/overview" },
  { label: "Holdings", href: "/holdings" },
  { label: "FX Lab", href: "/fx-lab" },
  { label: "Charts", href: "/charts" },
  { label: "Analysis", href: "/analysis" },
  { label: "Add / Import", href: "/add" },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabbar">
      {TABS.map(({ label, href }) => (
        <Link
          key={href}
          href={href}
          className={"tab" + (pathname === href ? " active" : "")}
        >
          {label}
        </Link>
      ))}
      <div className="tab-spacer" />
    </nav>
  );
}
