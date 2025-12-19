import { useState, useEffect, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { CrudTable, Column } from "@/components/crud/CrudTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { segmentsService, Segment as APISegment } from "@/services/api";
import { Upload, Loader2 } from "lucide-react";

interface Segment {
  id: string;
  name: string;
}

export default function Segmentos() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [formData, setFormData] = useState({ name: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mapApiToLocal = (apiSegment: APISegment): Segment => ({
    id: apiSegment.id.toString(),
    name: apiSegment.name,
  });

  const loadSegments = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await segmentsService.list();
      setSegments(data.map(mapApiToLocal));
    } catch (error) {
      toast({
        title: "Erro ao carregar segmentos",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSegments();
  }, [loadSegments]);

  const columns: Column<Segment>[] = [
    { key: "name", label: "Nome" }
  ];

  const handleAdd = () => {
    setEditingSegment(null);
    setFormData({ name: '' });
    setIsFormOpen(true);
  };

  const handleEdit = (segment: Segment) => {
    setEditingSegment(segment);
    setFormData({ name: segment.name });
    setIsFormOpen(true);
  };

  const handleDelete = async (segment: Segment) => {
    try {
      await segmentsService.delete(parseInt(segment.id));
      setSegments(segments.filter(s => s.id !== segment.id));
      toast({
        title: "Segmento excluído",
        description: "Segmento removido com sucesso",
      });
    } catch (error) {
      toast({
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Erro ao excluir segmento",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "O nome do segmento é obrigatório",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      if (editingSegment) {
        const updated = await segmentsService.update(parseInt(editingSegment.id), formData.name.trim());
        setSegments(segments.map(s => s.id === editingSegment.id ? mapApiToLocal(updated) : s));
        toast({
          title: "Segmento atualizado",
          description: "Segmento atualizado com sucesso",
        });
      } else {
        const created = await segmentsService.create(formData.name.trim());
        setSegments([...segments, mapApiToLocal(created)]);
        toast({
          title: "Segmento criado",
          description: "Segmento criado com sucesso",
        });
      }
      setIsFormOpen(false);
    } catch (error) {
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro ao salvar segmento",
        variant: "destructive",
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
      const result = await segmentsService.uploadCSV(file);
      toast({
        title: "Importação concluída",
        description: `${result.message}. ${result.errors.length > 0 ? `${result.errors.length} erro(s) encontrado(s).` : ''}`,
        variant: result.errors.length > 0 ? "default" : "success",
      });

      if (result.errors.length > 0) {
        console.warn('Erros na importação:', result.errors);
      }

      // Recarregar lista de segmentos
      await loadSegments();
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
        <Label htmlFor="name">Nome do Segmento *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </div>
  );

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
            id="csv-upload-segments"
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
          title="Segmentos"
          subtitle="Gerenciar segmentos de atendimento"
          columns={columns}
          data={segments}
          searchPlaceholder="Buscar segmentos..."
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          renderForm={renderForm}
          isFormOpen={isFormOpen}
          onFormOpenChange={setIsFormOpen}
          editingItem={editingSegment}
        />
      </div>
    </MainLayout>
  );
}
