import { useState, useEffect, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { CrudTable, Column } from "@/components/crud/CrudTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { Loader2, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { tabulationsService, type Tabulation as ApiTabulation } from "@/services/api";

interface Tabulation {
  id: string;
  name: string;
  isCPC: boolean;
  isEnvio: boolean;
  isEntregue: boolean;
  isLido: boolean;
  isRetorno: boolean;
  isCPCProd: boolean;
  isBoleto: boolean;
}

export default function Tabulacoes() {
  const [tabulations, setTabulations] = useState<Tabulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTabulation, setEditingTabulation] = useState<Tabulation | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    isCPC: false,
    isEnvio: true,
    isEntregue: true,
    isLido: true,
    isRetorno: true,
    isCPCProd: false,
    isBoleto: false
  });

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await tabulationsService.list();
      setTabulations(data.map((t: ApiTabulation) => ({
        id: String(t.id),
        name: t.name,
        isCPC: t.isCPC,
        isEnvio: t.isEnvio,
        isEntregue: t.isEntregue,
        isLido: t.isLido,
        isRetorno: t.isRetorno,
        isCPCProd: t.isCPCProd,
        isBoleto: t.isBoleto
      })));

    } catch (error) {
      console.error('Error loading tabulations:', error);
      toast({
        title: "Erro ao carregar dados",
        description: "Não foi possível carregar as tabulações",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<Tabulation>[] = [
    { key: "name", label: "Nome" },
    {
      key: "isCPC",
      label: "CPC",
      render: (tab) => (
        <Badge variant={tab.isCPC ? "default" : "secondary"} className={tab.isCPC ? "bg-success" : ""}>
          {tab.isCPC ? "Sim" : "Não"}
        </Badge>
      )
    }
  ];

  const handleAdd = () => {
    setEditingTabulation(null);
    setFormData({
      name: '',
      isCPC: false,
      isEnvio: true,
      isEntregue: true,
      isLido: true,
      isRetorno: true,
      isCPCProd: false,
      isBoleto: false
    });
    setIsFormOpen(true);
  };

  const handleEdit = (tabulation: Tabulation) => {
    setEditingTabulation(tabulation);
    setFormData({
      name: tabulation.name,
      isCPC: tabulation.isCPC,
      isEnvio: tabulation.isEnvio,
      isEntregue: tabulation.isEntregue,
      isLido: tabulation.isLido,
      isRetorno: tabulation.isRetorno,
      isCPCProd: tabulation.isCPCProd,
      isBoleto: tabulation.isBoleto
    });
    setIsFormOpen(true);
  };


  const handleDelete = async (tabulation: Tabulation) => {
    try {
      await tabulationsService.delete(Number(tabulation.id));
      setTabulations(tabulations.filter(t => t.id !== tabulation.id));
      toast({
        title: "Tabulação removida",
        description: `A tabulação ${tabulation.name} foi removida com sucesso`,
      });
    } catch (error) {
      console.error('Error deleting tabulation:', error);
      toast({
        title: "Erro ao remover",
        description: "Não foi possível remover a tabulação",
        variant: "destructive"
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "Informe o nome da tabulação",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      if (editingTabulation) {
        const updated = await tabulationsService.update(Number(editingTabulation.id), {
          name: formData.name,
          isCPC: formData.isCPC,
          isEnvio: formData.isEnvio,
          isEntregue: formData.isEntregue,
          isLido: formData.isLido,
          isRetorno: formData.isRetorno,
          isCPCProd: formData.isCPCProd,
          isBoleto: formData.isBoleto
        });
        setTabulations(tabulations.map(t => t.id === editingTabulation.id ? {
          id: String(updated.id),
          name: updated.name,
          isCPC: updated.isCPC,
          isEnvio: updated.isEnvio,
          isEntregue: updated.isEntregue,
          isLido: updated.isLido,
          isRetorno: updated.isRetorno,
          isCPCProd: updated.isCPCProd,
          isBoleto: updated.isBoleto
        } : t));
        toast({
          title: "Tabulação atualizada",
          description: `A tabulação ${updated.name} foi atualizada com sucesso`,
        });
      } else {
        const created = await tabulationsService.create(
          formData.name,
          formData.isCPC,
          formData.isEnvio,
          formData.isEntregue,
          formData.isLido,
          formData.isRetorno,
          formData.isCPCProd,
          formData.isBoleto
        );
        setTabulations([...tabulations, {
          id: String(created.id),
          name: created.name,
          isCPC: created.isCPC,
          isEnvio: created.isEnvio,
          isEntregue: created.isEntregue,
          isLido: created.isLido,
          isRetorno: created.isRetorno,
          isCPCProd: created.isCPCProd,
          isBoleto: created.isBoleto
        }]);
        toast({
          title: "Tabulação criada",
          description: `A tabulação ${created.name} foi criada com sucesso`,
        });
      }

      setIsFormOpen(false);
    } catch (error) {
      console.error('Error saving tabulation:', error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Não foi possível salvar a tabulação",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      toast({
        title: "Arquivo inválido",
        description: "Por favor, selecione um arquivo CSV",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const result = await tabulationsService.uploadCSV(file);
      toast({
        title: "Importação concluída",
        description: `${result.message}. ${result.errors.length > 0 ? `${result.errors.length} erro(s) encontrado(s).` : ''}`,
        variant: result.errors.length > 0 ? "default" : "default",
      });

      if (result.errors.length > 0) {
        console.warn('Erros na importação:', result.errors);
      }

      // Recarregar lista de tabulações
      await loadData();
    } catch (error) {
      console.error('Error uploading CSV:', error);
      toast({
        title: "Erro ao importar",
        description: error instanceof Error ? error.message : "Não foi possível importar o arquivo CSV",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      // Limpar input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const renderForm = () => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nome da Tabulação</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Ex: Venda Realizada, Não Atendeu"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isCPC"
            checked={formData.isCPC}
            onCheckedChange={(checked) => setFormData({ ...formData, isCPC: checked === true })}
          />
          <Label htmlFor="isCPC" className="text-sm font-normal">
            É CPC
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isEnvio"
            checked={formData.isEnvio}
            onCheckedChange={(checked) => setFormData({ ...formData, isEnvio: checked === true })}
          />
          <Label htmlFor="isEnvio" className="text-sm font-normal">
            Envio
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isEntregue"
            checked={formData.isEntregue}
            onCheckedChange={(checked) => setFormData({ ...formData, isEntregue: checked === true })}
          />
          <Label htmlFor="isEntregue" className="text-sm font-normal">
            Entregue
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isLido"
            checked={formData.isLido}
            onCheckedChange={(checked) => setFormData({ ...formData, isLido: checked === true })}
          />
          <Label htmlFor="isLido" className="text-sm font-normal">
            Lido
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isRetorno"
            checked={formData.isRetorno}
            onCheckedChange={(checked) => setFormData({ ...formData, isRetorno: checked === true })}
          />
          <Label htmlFor="isRetorno" className="text-sm font-normal">
            Retorno
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isCPCProd"
            checked={formData.isCPCProd}
            onCheckedChange={(checked) => setFormData({ ...formData, isCPCProd: checked === true })}
          />
          <Label htmlFor="isCPCProd" className="text-sm font-normal">
            CPC Produtivo
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isBoleto"
            checked={formData.isBoleto}
            onCheckedChange={(checked) => setFormData({ ...formData, isBoleto: checked === true })}
          />
          <Label htmlFor="isBoleto" className="text-sm font-normal">
            Boleto
          </Label>
        </div>
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
        <div className="mb-4 flex justify-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleUploadCSV}
            className="hidden"
            id="csv-upload-tabulations"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Importar CSV
              </>
            )}
          </Button>
        </div>
        <CrudTable
          title="Tabulações"
          subtitle="Gerenciar tipos de finalização de atendimento"
          columns={columns}
          data={tabulations}
          searchPlaceholder="Buscar tabulações..."
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          renderForm={renderForm}
          isFormOpen={isFormOpen}
          onFormOpenChange={setIsFormOpen}
          editingItem={editingTabulation}
        />
      </div>
    </MainLayout>
  );
}
