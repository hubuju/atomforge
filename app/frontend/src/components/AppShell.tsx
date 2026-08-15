import { Link } from 'react-router-dom';
import { LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Session } from '@/lib/client';

export function BrandMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span
      className={`grid place-items-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30 ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
        <ellipse cx="12" cy="12" rx="9.2" ry="4.2" />
        <ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(120 12 12)" />
      </svg>
    </span>
  );
}

export function BrandLink({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5">
      <BrandMark />
      <span className="font-display text-[15px] font-semibold tracking-tight">AtomForge</span>
    </Link>
  );
}

interface TopBarProps {
  session: Session;
  /** Extra controls rendered on the right, before the account menu. */
  children?: React.ReactNode;
  /** Slot rendered next to the brand, e.g. project name + version badge. */
  lead?: React.ReactNode;
}

export function TopBar({ session, children, lead }: TopBarProps) {
  const { status, account, signOut } = session;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/70 px-4 backdrop-blur-sm">
      <BrandLink />
      {lead ? <div className="flex min-w-0 items-center gap-2">{lead}</div> : null}
      <div className="ml-auto flex items-center gap-2">
        {children}

        <ThemeToggle />

        {status === 'loading' ? (
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
        ) : status === 'authenticated' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full border border-border"
                aria-label="账户菜单"
              >
                <UserIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="truncate text-[12px] font-normal text-muted-foreground">
                {account?.name || '当前账号'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/">我的项目</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void signOut()}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" className="h-8" asChild>
            <Link to="/auth">登录 / 注册</Link>
          </Button>
        )}
      </div>
    </header>
  );
}

interface StatePanelProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'default' | 'danger';
}

/** Shared empty / error / gated panel so every surface has real states. */
export function StatePanel({ title, description, icon, action, tone = 'default' }: StatePanelProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      {icon ? (
        <div
          className={`grid h-11 w-11 place-items-center rounded-lg border ${
            tone === 'danger'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border bg-secondary text-muted-foreground'
          }`}
        >
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}