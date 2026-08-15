import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Importing the theme module paints the stored preference onto <html> before
// the first render, so there is no flash of the wrong surface colour.
import '@/lib/theme';
import Index from './pages/Index';
import Auth from './pages/Auth';
import Workspace from './pages/Workspace';
import Share from './pages/Share';
import NotFound from './pages/NotFound';
import AuthCallback from './pages/AuthCallback';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/w/:id" element={<Workspace />} />
          <Route path="/s/:slug" element={<Share />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;