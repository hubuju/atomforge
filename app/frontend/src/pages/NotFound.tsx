import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLink, StatePanel } from '@/components/AppShell';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-card/70 px-4">
        <BrandLink />
      </header>
      <main className="flex flex-1 items-center justify-center">
        <StatePanel
          icon={<Compass className="h-5 w-5" />}
          title="这个页面不存在"
          description="链接可能已经失效，或者这个应用还没有被公开发布。"
          action={
            <Button asChild>
              <Link to="/">回到工作区</Link>
            </Button>
          }
        />
      </main>
    </div>
  );
}