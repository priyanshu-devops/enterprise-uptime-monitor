'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  LayoutDashboard,
  Globe,
  Upload,
  BarChart3,
  FileText,
  ScrollText,
  ShieldCheck,
  Settings,
  PlayCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/domains', label: 'Domains', icon: Globe },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/jobs', label: 'Jobs', icon: PlayCircle },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/audit', label: 'Audit', icon: ShieldCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Uptime Monitor';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Activity className="h-4 w-4" />
        </div>
        <span className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 text-2xs text-muted-foreground">
        <p>v1.0.0 · Free-tier stack</p>
      </div>
    </div>
  );
}
