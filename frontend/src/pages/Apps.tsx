import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { CrudTable, Column } from "@/components/crud/CrudTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { appsService, App as APIApp, CreateAppData } from "@/services/api";

interface App {
  id: string;
  name: string;
  accessToken: string;
  appSecret?: string | null;
  webhookVerifyToken?: string | null;
  wabaId?: string | null;
}

export default function Apps() {
  const [apps, setApps] = useState<App[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    accessToken: '',
    appSecret: '',
    webhookVerifyToken: '',
    wabaId: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const mapApiToLocal = (apiApp: APIApp): App => ({
    id: apiApp.id.toString(),
    name: apiApp.name,
    accessToken: apiApp.accessToken,
    appSecret: apiApp.appSecret,
    webhookVerifyToken: apiApp.webhookVerifyToken,
    wabaId: apiApp.wabaId,
  });

  const loadApps = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await appsService.list();
      setApps(data.map(mapApiToLocal));
    } catch (error) {
      toast({
        title: "Erro ao carregar apps",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const columns: Column<App>[] = [
    { key: "name", label: "Nome" },
    { 
      key: "wabaId", 
      label: "WABA ID",
      render: (app) => app.wabaId || "-"
    },
  ];

  const handleAdd = () => {
    setEditingApp(null);
    setFormData({
      name: '',
      accessToken: '',
      appSecret: '',
      webhookVerifyToken: '',
      wabaId: '',
    });
    setIsFormOpen(true);
  };

  const handleEdit = (app: App) => {
    setEditingApp(app);
    setFormData({
      name: app.name,
      accessToken: app.accessToken,
      appSecret: app.appSecret || '',
      webhookVerifyToken: app.webhookVerifyToken || '',
      wabaId: app.wabaId || '',
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (app: App) => {
    if (!confirm(`Tem certeza que deseja excluir o app "${app.name}"?`)) {
      return;
    }

    try {
      await appsService.delete(parseInt(app.id));
      setApps(apps.filter(a => a.id !== app.id));
      toast({
        title: "App excluído",
        description: "App removido com sucesso",
      });
    } catch (error) {
      toast({
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Erro ao excluir app",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "O nome do app é obrigatório",
        variant: "destructive",
      });
      return;
    }

    if (!formData.accessToken.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "O Access Token é obrigatório",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const appData: CreateAppData = {
        name: formData.name.trim(),
        accessToken: formData.accessToken.trim(),
        appSecret: formData.appSecret.trim() || undefined,
        webhookVerifyToken: formData.webhookVerifyToken.trim() || undefined,
        wabaId: formData.wabaId.trim() || undefined,
      };

      if (editingApp) {
        const updated = await appsService.update(parseInt(editingApp.id), appData);
        setApps(apps.map(a => a.id === editingApp.id ? mapApiToLocal(updated) : a));
        toast({
          title: "App atualizado",
          description: "App atualizado com sucesso",
        });
      } else {
        const created = await appsService.create(appData);
        setApps([...apps, mapApiToLocal(created)]);
        toast({
          title: "App criado",
          description: "App criado com sucesso",
        });
      }
      setIsFormOpen(false);
    } catch (error) {
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro ao salvar app",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderForm = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nome *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Meu App WhatsApp"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="accessToken">Access Token *</Label>
        <Input
          id="accessToken"
          type="password"
          value={formData.accessToken}
          onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
          placeholder="EAAxxxxxxxxxxxxx"
        />
        <p className="text-xs text-muted-foreground">Token de acesso permanente do WhatsApp Cloud API</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="appSecret">App Secret (opcional)</Label>
        <Input
          id="appSecret"
          type="password"
          value={formData.appSecret}
          onChange={(e) => setFormData({ ...formData, appSecret: e.target.value })}
          placeholder="xxxxxxxxxxxxxxxxxxxxx"
        />
        <p className="text-xs text-muted-foreground">App Secret para validação de assinatura do webhook</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="webhookVerifyToken">Webhook Verify Token (opcional)</Label>
        <Input
          id="webhookVerifyToken"
          type="password"
          value={formData.webhookVerifyToken}
          onChange={(e) => setFormData({ ...formData, webhookVerifyToken: e.target.value })}
          placeholder="meu_token_secreto"
        />
        <p className="text-xs text-muted-foreground">Token de verificação do webhook</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wabaId">WABA ID (opcional)</Label>
        <Input
          id="wabaId"
          value={formData.wabaId}
          onChange={(e) => setFormData({ ...formData, wabaId: e.target.value })}
          placeholder="123456789012345"
        />
        <p className="text-xs text-muted-foreground">WhatsApp Business Account ID</p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </div>
  );

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="animate-fade-in">
        <CrudTable
          title="Apps WhatsApp"
          subtitle="Gerenciar aplicativos do WhatsApp Cloud API"
          columns={columns}
          data={apps}
          searchPlaceholder="Buscar apps..."
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingApp ? "Editar App" : "Novo App"}
              </DialogTitle>
            </DialogHeader>
            {renderForm()}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}

