import { useState } from "react";
import { 
  Headphones, 
  Eye, 
  BookUser, 
  Megaphone, 
  Table2, 
  Filter, 
  Ban, 
  FileText, 
  BarChart3,
  RefreshCw,
  Phone,
  Users,
  Tags,
  Code,
  LogOut,
  Settings,
  Sliders,
  Moon,
  Sun,
  TrendingUp,
  Activity,
  Menu,
  X,
  Smartphone
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { VendLogo } from "./VendLogo";
import { useAuth } from "@/contexts/AuthContext";
import { UserRole } from "@/types/auth";
import { NotificationSettingsDialog } from "@/components/settings/NotificationSettingsDialog";
import { useTheme } from "next-themes";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ElementType;
  color: string;
  roles: UserRole[];
}

const menuItems: MenuItem[] = [
  { title: "Atendimento", url: "/atendimento", icon: Headphones, color: "text-cyan", roles: ['operador', 'admin'] },
  { title: "Supervisionar", url: "/supervisionar", icon: Eye, color: "text-warning", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Contatos", url: "/contatos", icon: BookUser, color: "text-cyan", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Campanhas", url: "/campanhas", icon: Megaphone, color: "text-primary", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Tabulações", url: "/tabulacoes", icon: Table2, color: "text-whatsapp", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Segmentos", url: "/segmentos", icon: Filter, color: "text-destructive", roles: ['admin', 'digital'] },
  { title: "Blocklist", url: "/blocklist", icon: Ban, color: "text-muted-foreground", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Templates", url: "/templates", icon: FileText, color: "text-primary", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3, color: "text-success", roles: ['supervisor', 'digital', 'admin'] },
  { title: "Acompanhamento", url: "/acompanhamento", icon: Activity, color: "text-primary", roles: ['admin'] },
  { title: "Produtividade Ativadores", url: "/produtividade-ativadores", icon: TrendingUp, color: "text-success", roles: ['admin'] },
  { title: "Painel Controle", url: "/painel-controle", icon: Sliders, color: "text-purple-500", roles: ['admin'] },
  { title: "Linhas", url: "/linhas", icon: Phone, color: "text-whatsapp", roles: ['admin', 'ativador'] },
  { title: "Apps", url: "/apps", icon: Smartphone, color: "text-primary", roles: ['admin'] },
  { title: "Usuários", url: "/usuarios", icon: Users, color: "text-warning", roles: ['admin'] },
  { title: "Tags", url: "/tags", icon: Tags, color: "text-cyan", roles: ['admin'] },
  { title: "Logs API", url: "/logs", icon: Code, color: "text-destructive", roles: ['admin'] },
];

export function AppSidebar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  if (!user) return null;

  const filteredItems = menuItems.filter(item => item.roles.includes(user.role));
  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  
  const roleLabels: Record<UserRole, string> = {
    admin: 'Administrador',
    supervisor: 'Supervisor',
    operador: 'Operador',
    ativador: 'Ativador',
    digital: 'Digital'
  };

  const toggleTheme = () => {
    setTheme((!theme || theme === 'light') ? 'dark' : 'light');
  };

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border flex justify-center">
        <VendLogo size="xl" showText={false} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {filteredItems.map((item) => {
            const isActive = location.pathname === item.url;
            const Icon = item.icon;
            
            return (
              <li key={item.url}>
                <Link
                  to={item.url}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
                    "hover:bg-sidebar-accent/20",
                    isActive && "bg-gradient-to-r from-primary/20 to-cyan/10 text-sidebar-foreground"
                  )}
                >
                  <Icon className={cn("w-5 h-5", item.color)} />
                  <span className="text-sm font-medium text-sidebar-foreground">
                    {item.title}
                  </span>
                </Link>
              </li>
            );
          })}
          
          {/* Separador */}
          <li className="pt-2 mt-2 border-t border-sidebar-border">
            <button
              onClick={toggleTheme}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
                "hover:bg-sidebar-accent/20 text-sidebar-foreground"
              )}
            >
              {(!theme || theme === 'light') ? (
                <Moon className="w-5 h-5 text-muted-foreground" />
              ) : (
                <Sun className="w-5 h-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {(!theme || theme === 'light') ? 'Modo Escuro' : 'Modo Claro'}
              </span>
            </button>
          </li>
          
          <li>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
                "hover:bg-sidebar-accent/20 text-sidebar-foreground"
              )}
            >
              <Settings className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium">Configurações</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground">{roleLabels[user.role]}</p>
          </div>
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-sidebar-accent/20 transition-colors"
            title="Sair"
          >
            <LogOut className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 min-h-screen bg-sidebar flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Menu */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetTrigger asChild>
          <button
            className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-sidebar hover:bg-sidebar-accent/20 transition-colors"
            aria-label="Abrir menu"
          >
            <Menu className="w-6 h-6 text-sidebar-foreground" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
          <div className="flex flex-col h-full">
            <SidebarContent />
          </div>
        </SheetContent>
      </Sheet>

      <NotificationSettingsDialog 
        open={isSettingsOpen} 
        onOpenChange={setIsSettingsOpen} 
      />
    </>
  );
}
