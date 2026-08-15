import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, KeyRound, Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { BrandMark } from '@/components/AppShell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { api, errorText, useSession } from '@/lib/client';

const HIGHLIGHTS = [
  '对话生成 · 过程逐字可见',
  '多文件项目 · HTML / CSS / JS 分开写',
  '沙箱预览 · 报错可一键让 AI 修复',
  '版本快照 · 随时回滚任意一版',
];

/**
 * Minimal account gate: a display name plus a password (typed twice when
 * registering). No email, no verification, no hosted redirect — the product
 * owner asked for the shortest possible path into the workspace.
 */
export default function Auth() {
  const session = useSession();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [pending, setPending] = useState(false);

  const [regName, setRegName] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regPass2, setRegPass2] = useState('');

  const [loginName, setLoginName] = useState('');
  const [loginPass, setLoginPass] = useState('');

  useEffect(() => {
    if (session.status === 'authenticated') navigate('/', { replace: true });
  }, [session.status, navigate]);

  const handleRegister = async () => {
    const name = regName.trim();
    if (name.length < 2 || name.length > 24) {
      toast({ title: '名称需为 2-24 个字符', variant: 'destructive' });
      return;
    }
    if (regPass.length < 6) {
      toast({ title: '密码至少 6 位', variant: 'destructive' });
      return;
    }
    if (regPass !== regPass2) {
      toast({ title: '两次输入的密码不一致', variant: 'destructive' });
      return;
    }
    setPending(true);
    try {
      const res = await api.register(name, regPass);
      session.signIn(res.token, res.account);
      toast({ title: `欢迎，${res.account.name}` });
      navigate('/', { replace: true });
    } catch (error) {
      toast({ title: '注册失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setPending(false);
    }
  };

  const handleLogin = async () => {
    const name = loginName.trim();
    if (!name || !loginPass) {
      toast({ title: '请输入名称和密码', variant: 'destructive' });
      return;
    }
    setPending(true);
    try {
      const res = await api.login(name, loginPass);
      session.signIn(res.token, res.account);
      navigate('/', { replace: true });
    } catch (error) {
      toast({ title: '登录失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-[0.3]" />

      <div className="absolute right-4 top-4 z-10 sm:right-6">
        <ThemeToggle />
      </div>

      <main className="relative mx-auto flex w-full max-w-screen-lg flex-1 items-center px-4 py-12 sm:px-6">
        <div className="grid w-full gap-10 lg:grid-cols-12 lg:items-center lg:gap-14">
          {/* Left: what this is */}
          <div className="lg:col-span-6">
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-9 w-9" />
              <span className="font-display text-lg font-semibold tracking-tight">AtomForge</span>
            </div>
            <h1 className="mt-7 text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">
              描述需求，
              <br />
              直接拿到能跑的项目
            </h1>
            <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
              智能体把应用拆成 index.html、styles.css、app.js 逐个文件写出来，
              沙箱里立刻运行。只要一个名称和密码就能开始。
            </p>

            <ul className="mt-7 space-y-2.5">
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: name + password */}
          <div className="lg:col-span-6">
            <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <Tabs value={tab} onValueChange={(value) => setTab(value as 'register' | 'login')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="register" className="gap-1.5 text-[13px]">
                    <UserPlus className="h-3.5 w-3.5" />
                    注册
                  </TabsTrigger>
                  <TabsTrigger value="login" className="gap-1.5 text-[13px]">
                    <LogIn className="h-3.5 w-3.5" />
                    登录
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="register" className="mt-5 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">名称</Label>
                    <Input
                      id="reg-name"
                      value={regName}
                      onChange={(event) => setRegName(event.target.value)}
                      placeholder="2-24 个字符，用于登录"
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-pass">密码</Label>
                    <Input
                      id="reg-pass"
                      type="password"
                      value={regPass}
                      onChange={(event) => setRegPass(event.target.value)}
                      placeholder="至少 6 位"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-pass2">确认密码</Label>
                    <Input
                      id="reg-pass2"
                      type="password"
                      value={regPass2}
                      onChange={(event) => setRegPass2(event.target.value)}
                      placeholder="再输入一次"
                      autoComplete="new-password"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !pending) void handleRegister();
                      }}
                    />
                    {regPass2 && regPass !== regPass2 ? (
                      <p className="text-[11.5px] text-destructive">两次输入的密码不一致</p>
                    ) : null}
                  </div>
                  <Button className="w-full gap-2" size="lg" onClick={handleRegister} disabled={pending}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    {pending ? '正在创建…' : '注册并进入'}
                  </Button>
                  <p className="text-center text-[11.5px] text-muted-foreground">
                    不需要邮箱和验证码，名称就是你的登录账号。
                  </p>
                </TabsContent>

                <TabsContent value="login" className="mt-5 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-name">名称</Label>
                    <Input
                      id="login-name"
                      value={loginName}
                      onChange={(event) => setLoginName(event.target.value)}
                      placeholder="注册时填的名称"
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-pass">密码</Label>
                    <Input
                      id="login-pass"
                      type="password"
                      value={loginPass}
                      onChange={(event) => setLoginPass(event.target.value)}
                      autoComplete="current-password"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !pending) void handleLogin();
                      }}
                    />
                  </div>
                  <Button className="w-full gap-2" size="lg" onClick={handleLogin} disabled={pending}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    {pending ? '正在登录…' : '登录'}
                  </Button>
                  <p className="text-center text-[11.5px] text-muted-foreground">
                    登录后回到工作区，之前的项目与版本历史都在。
                  </p>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative mx-auto w-full max-w-screen-lg px-4 py-6 sm:px-6">
        <p className="text-xs text-muted-foreground">AtomForge · 智能体驱动的应用生成工作台</p>
      </footer>
    </div>
  );
}