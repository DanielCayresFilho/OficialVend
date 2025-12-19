import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { CrudTable, Column } from "@/components/crud/CrudTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { toast } from "@/hooks/use-toast";
import { linesService, segmentsService, appsService, type Line as ApiLine, type Segment, type App as APIApp } from "@/services/api";

interface Line {
  id: string;
  phone: string;
  status: 'active' | 'banned';
  numberId?: string;
  segment?: number;
  operators?: Array<{
    id: number;
    name: string;
    email: string;
  }>;
}

export default function Linhas() {
  const [lines, setLines] = useState<Line[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [apps, setApps] = useState<APIApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Line | null>(null);
  const [formData, setFormData] = useState({
    phone: '',
    segment: '',
    appId: '',
    numberId: '',
    receiveMedia: false
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const { playSuccessSound, playErrorSound, playWarningSound } = useNotificationSound();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [linesData, segmentsData, appsData] = await Promise.all([
        linesService.list(),
        segmentsService.list(),
        appsService.list()
      ]);

      setLines(linesData.map((l: ApiLine) => ({
        id: String(l.id),
        phone: l.phone,
        status: l.lineStatus === 'active' ? 'active' : 'banned',
        numberId: l.numberId || undefined,
        segment: l.segment ?? undefined,
        operators: l.operators || []
      })));

      setSegments(segmentsData);
      setApps(appsData);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Erro ao carregar dados",
        description: "Não foi possível carregar as linhas",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<Line>[] = [
    { key: "phone", label: "Telefone" },
    {
      key: "status",
      label: "Status",
      render: (line) => (
        <Badge className={line.status === 'active' ? "bg-success" : "bg-destructive"}>
          {line.status === 'active' ? "Ativa" : "Banida"}
        </Badge>
      )
    },
    { 
      key: "numberId", 
      label: "Number ID",
      render: (line) => line.numberId || <span className="text-muted-foreground">-</span>
    },
    {
      key: "operators",
      label: "Operador(es)",
      render: (line) => {
        if (!line.operators || line.operators.length === 0) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <div className="flex flex-col gap-1">
            {line.operators.map((op) => (
              <span key={op.id} className="text-sm">
                {op.name}
              </span>
            ))}
          </div>
        );
      }
    }
  ];

  const handleAdd = () => {
    setEditingLine(null);
    setFormData({ 
      phone: '', 
      segment: '', 
      appId: '', 
      numberId: '', 
      receiveMedia: false 
    });
    setIsFormOpen(true);
  };

  const handleEdit = async (line: Line) => {
    setEditingLine(line);
    // Buscar dados completos da linha
    try {
      const fullLine = await linesService.getById(Number(line.id));
      setFormData({
        phone: line.phone,
        segment: line.segment ? String(line.segment) : '',
        appId: fullLine.appId ? String(fullLine.appId) : '',
        numberId: fullLine.numberId || '',
        receiveMedia: fullLine.receiveMedia || false
      });
    } catch {
      setFormData({
        phone: line.phone,
        segment: line.segment ? String(line.segment) : '',
        appId: '',
        numberId: '',
        receiveMedia: false
      });
    }
    setIsFormOpen(true);
  };

  const handleDelete = async (line: Line) => {
    try {
      await linesService.delete(Number(line.id));
      setLines(lines.filter(l => l.id !== line.id));
      playWarningSound();
      toast({
        title: "Linha removida",
        description: `A linha ${line.phone} foi removida com sucesso`,
        variant: "destructive"
      });
    } catch (error) {
      console.error('Error deleting line:', error);
      playErrorSound();
      toast({
        title: "Erro ao remover",
        description: "Não foi possível remover a linha",
        variant: "destructive"
      });
    }
  };

  const handleSave = async () => {
    if (!formData.phone) {
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description: "Preencha o telefone da linha",
        variant: "destructive"
      });
      return;
    }

    if (!formData.appId) {
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description: "Selecione um App",
        variant: "destructive"
      });
      return;
    }

    if (!formData.numberId) {
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description: "Number ID é obrigatório",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      const lineData = {
        phone: formData.phone,
        segment: formData.segment ? Number(formData.segment) : undefined,
        appId: Number(formData.appId),
        numberId: formData.numberId,
        receiveMedia: formData.receiveMedia,
      };

      if (editingLine) {
        const updated = await linesService.update(Number(editingLine.id), lineData);
        setLines(lines.map(l => l.id === editingLine.id ? {
          id: String(updated.id),
          phone: updated.phone,
          status: updated.lineStatus === 'active' ? 'active' : 'banned',
          numberId: updated.numberId || undefined,
          segment: updated.segment ?? undefined,
          operators: updated.operators || []
        } : l));
        playSuccessSound();
        toast({
          title: "Linha atualizada",
          description: `A linha ${updated.phone} foi atualizada com sucesso`,
        });
      } else {
        const created = await linesService.create(lineData);
        setLines([...lines, {
          id: String(created.id),
          phone: created.phone,
          status: created.lineStatus === 'active' ? 'active' : 'banned',
          numberId: created.numberId || undefined,
          segment: created.segment ?? undefined,
          operators: created.operators || []
        }]);
        playSuccessSound();
        toast({
          title: "Linha criada",
          description: `A linha ${created.phone} foi criada com sucesso`,
        });
      }
      setIsFormOpen(false);
    } catch (error) {
      console.error('Error saving line:', error);
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Não foi possível salvar a linha",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!editingLine) return;
    
    setIsTestingConnection(true);
    try {
      const result = await linesService.testConnection(Number(editingLine.id));
      playSuccessSound();
      toast({
        title: result.connected ? "Conexão OK" : "Conexão falhou",
        description: result.message,
        variant: result.connected ? "default" : "destructive"
      });
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao testar conexão",
        description: error instanceof Error ? error.message : "Não foi possível testar a conexão",
        variant: "destructive"
      });
    } finally {
      setIsTestingConnection(false);
    }
  };



  const renderForm = () => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="phone">Telefone *</Label>
        <Input
          id="phone"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="5511999999999"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="segment">Segmento</Label>
        <Select value={formData.segment} onValueChange={(value) => setFormData({ ...formData, segment: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um segmento" />
          </SelectTrigger>
          <SelectContent>
            {segments.map((segment) => (
              <SelectItem key={segment.id} value={String(segment.id)}>
                {segment.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Credenciais WhatsApp Cloud API */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Credenciais WhatsApp Cloud API</Label>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="appId">App *</Label>
          <Select
            value={formData.appId}
            onValueChange={(value) => setFormData({ ...formData, appId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione um App" />
            </SelectTrigger>
            <SelectContent>
              {apps.map((app) => (
                <SelectItem key={app.id} value={String(app.id)}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">App que contém as credenciais (Access Token, App Secret, etc)</p>
          {apps.length === 0 && (
            <p className="text-xs text-destructive">Nenhum app cadastrado. Crie um app primeiro em "Apps".</p>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="numberId">Phone Number ID *</Label>
          <Input
            id="numberId"
            value={formData.numberId}
            onChange={(e) => setFormData({ ...formData, numberId: e.target.value })}
            placeholder="123456789012345"
          />
          <p className="text-xs text-muted-foreground">ID do número de telefone no WhatsApp Cloud API</p>
        </div>
      </div>

      {/* Receber Mídia */}
      <div className="flex items-center space-x-2 pt-2">
        <Checkbox
          id="receiveMedia"
          checked={formData.receiveMedia}
          onCheckedChange={(checked) => setFormData({ ...formData, receiveMedia: checked === true })}
        />
        <Label htmlFor="receiveMedia" className="text-sm font-normal">
          Receber Mídia (imagens, áudios, documentos)
        </Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Ativa o download automático de arquivos de mídia recebidos
      </p>

      {editingLine && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleTestConnection}
          disabled={isTestingConnection}
        >
          {isTestingConnection ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testando...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Testar Conexão
            </>
          )}
        </Button>
      )}

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
          title="Linhas WhatsApp"
          subtitle="Gerenciar linhas de atendimento"
          columns={columns}
          data={lines}
          searchPlaceholder="Buscar linhas..."
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          renderForm={renderForm}
          isFormOpen={isFormOpen}
          onFormOpenChange={setIsFormOpen}
          editingItem={editingLine}
          renderActions={(line) => (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={async () => {
                setEditingLine(line);
                setIsFormOpen(true);
                try {
                  const result = await linesService.testConnection(Number(line.id));
                  toast({
                    title: result.connected ? "Conexão OK" : "Conexão falhou",
                    description: result.message,
                    variant: result.connected ? "default" : "destructive"
                  });
                } catch (error) {
                  toast({
                    title: "Erro ao testar conexão",
                    description: error instanceof Error ? error.message : "Não foi possível testar",
                    variant: "destructive"
                  });
                }
              }}
              title="Testar Conexão"
            >
              {line.status === 'active' ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
            </Button>
          )}
        />
      </div>
    </MainLayout>
  );
}
