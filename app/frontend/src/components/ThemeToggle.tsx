import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme, type ThemePref } from '@/lib/theme';

const OPTIONS: { value: ThemePref; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', hint: '明亮环境 / 演示投屏', icon: Sun },
  { value: 'dark', label: '深色', hint: '长时间编码更护眼', icon: Moon },
  { value: 'system', label: '跟随系统', hint: '随系统外观自动切换', icon: Monitor },
];

/**
 * Theme switcher for the top bar. A single click on the icon flips between
 * light and dark (the common case); the dropdown exposes the explicit choices
 * including "follow system".
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { pref, resolved, setPref } = useTheme();
  const ActiveIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-full border border-border text-muted-foreground hover:text-foreground ${className}`}
          aria-label={`外观：${resolved === 'dark' ? '深色' : '浅色'}，点击切换`}
          title="切换外观"
        >
          <ActiveIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">外观</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const active = pref === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setPref(option.value)}
              className="gap-2.5 py-2"
            >
              <OptionIcon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="flex min-w-0 flex-col">
                <span className={`text-[13px] leading-tight ${active ? 'font-semibold text-foreground' : ''}`}>
                  {option.label}
                </span>
                <span className="truncate text-[11px] leading-tight text-muted-foreground">{option.hint}</span>
              </span>
              {active ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}