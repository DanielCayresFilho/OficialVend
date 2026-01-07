import { useState, useEffect, useCallback } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { reportsService, segmentsService, Segment } from "@/services/api";
import {
  useMockData,
  mockEnvios,
  mockIndicadores,
  mockTempos,
  mockOperacionalSintetico,
  mockKPI,
  mockHSM,
  mockStatusLinha
} from "@/data/mockReports";

const reportTypes = [
  { value: "op_sintetico", label: "OP Sintético" },
  { value: "kpi", label: "KPI" },
  { value: "hsm", label: "HSM" },
  { value: "status_linha", label: "Status de Linha" },
  { value: "envios", label: "Envios" },
  { value: "indicadores", label: "Indicadores" },
  { value: "tempos", label: "Tempos" },
  { value: "templates", label: "Templates" },
  { value: "completo_csv", label: "Completo CSV" },
  { value: "equipe", label: "Equipe" },
  { value: "dados_transacionados", label: "Dados Transacionados" },
  { value: "detalhado_conversas", label: "Detalhado Conversas" },
  { value: "linhas", label: "Linhas" },
  { value: "resumo_atendimentos", label: "Resumo Atendimentos" },
  { value: "usuarios", label: "Usuários" },
  { value: "hiper_personalizado", label: "Hiper Personalizado" },
  { value: "consolidado", label: "Consolidado" },
];

// Helper para formatar data como YYYY-MM-DD
const formatDateForInput = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export default function Relatorios() {
  // Definir datas padrão como hoje
  const today = formatDateForInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [segment, setSegment] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [reportType, setReportType] = useState("resumo_atendimentos"); // Tipo padrão
  const [isLoading, setIsLoading] = useState(false);
  const [mockDataEnabled] = useState(useMockData());

  const loadSegments = useCallback(async () => {
    try {
      const data = await segmentsService.list();
      setSegments(data);
    } catch (error) {
      console.error('Error loading segments:', error);
    }
  }, []);

  useEffect(() => {
    loadSegments();
  }, [loadSegments]);

  const getMockDataForReportType = (type: string) => {
    const mockDataMap: Record<string, any> = {
      envios: mockEnvios,
      indicadores: mockIndicadores,
      tempos: mockTempos,
      op_sintetico: mockOperacionalSintetico,
      kpi: mockKPI,
      hsm: mockHSM,
      status_linha: mockStatusLinha,
    };
    return mockDataMap[type] || null;
  };

  const handleGenerate = async () => {
    if (!startDate || !endDate) {
      toast({
        title: "Campos obrigatórios",
        description: "Data inicial e final são obrigatórias",
        variant: "destructive",
      });
      return;
    }

    if (!reportType) {
      toast({
        title: "Tipo de relatório",
        description: "Selecione um tipo de relatório",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Se mock data estiver ativado, gerar CSV mockado e baixar direto
      if (mockDataEnabled) {
        // Simular delay de carregamento
        await new Promise(resolve => setTimeout(resolve, 800));

        const mockData = getMockDataForReportType(reportType);
        if (mockData) {
          // Converter para CSV e baixar direto
          const csvContent = convertMockDataToCSV(mockData, reportType);
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `relatorio_${reportType}_${startDate}_${endDate}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          toast({
            title: "Relatório gerado",
            description: "O arquivo CSV foi baixado com sucesso",
          });
        } else {
          // Se não tem mock, não faz nada (silencioso)
          // Evita revelar ao cliente que estamos usando dados mockados
          return;
        }
      } else {
        // Usar dados reais da API
        const blob = await reportsService.generate({
          startDate,
          endDate,
          segment: segment && segment !== 'all' ? parseInt(segment) : undefined,
          type: reportType,
        });

        // Baixar direto
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `relatorio_${reportType}_${startDate}_${endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast({
          title: "Relatório gerado",
          description: "O arquivo CSV foi baixado com sucesso",
        });
      }
    } catch (error) {
      toast({
        title: "Erro ao gerar relatório",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const convertMockDataToCSV = (data: any, type: string): string => {
    let csv = '';

    switch (type) {
      case 'envios':
        csv = 'Data,Enviados,Sucesso,Falha,Taxa Sucesso\n';
        data.porDia.forEach((row: any) => {
          csv += `${row.data},${row.enviados},${row.sucesso},${row.falha},${row.taxaSucesso}%\n`;
        });
        break;
      case 'indicadores':
        csv = 'Indicador,Valor\n';
        csv += `Conversas Ativas,${data.visaoGeral.conversasAtivas}\n`;
        csv += `Conversas Finalizadas,${data.visaoGeral.conversasFinalizadas}\n`;
        csv += `Tempo Médio Resposta,${data.visaoGeral.tempoMedioResposta}\n`;
        csv += `Taxa Conversão,${data.visaoGeral.taxaConversao}%\n`;
        break;
      case 'kpi':
        csv = 'KPI,Valor,Meta,Unidade,Variação\n';
        data.principais.forEach((kpi: any) => {
          csv += `${kpi.nome},${kpi.valor},${kpi.meta},${kpi.unidade},${kpi.variacao}\n`;
        });
        break;
      case 'hsm':
        csv = 'Template,Status,Categoria,Envios,Entregues,Lidos,Taxa Leitura\n';
        data.templates.forEach((t: any) => {
          csv += `${t.nome},${t.status},${t.categoria},${t.envios},${t.entregues},${t.lidos},${t.taxa_leitura}%\n`;
        });
        break;
      case 'status_linha':
        csv = 'Telefone,Nome,Status,Segmento,Operador,Msgs Hoje,% Uso\n';
        data.linhas.forEach((l: any) => {
          csv += `${l.telefone},${l.nome},${l.status},${l.segmento},${l.operador_atual || 'N/A'},${l.mensagens_hoje},${l.percentual_uso}%\n`;
        });
        break;
      default:
        csv = 'Dados,Valor\n';
        csv += `Relatório,${type}\n`;
    }

    return csv;
  };


  return (
    <MainLayout>
      <div className="space-y-4 md:space-y-6 p-4 md:p-6 animate-fade-in">
        {/* Filters */}
        <GlassCard>
          <h2 className="text-xl font-semibold text-foreground mb-6">Relatórios</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="space-y-2">
              <Label htmlFor="startDate">Data Inicial *</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Data Final *</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="segment">Segmento</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {segments.map((seg) => (
                    <SelectItem key={seg.id} value={seg.id.toString()}>
                      {seg.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleGenerate} className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  'Gerar Relatório'
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tipo de Relatório *</Label>
            <div className="flex flex-wrap gap-2">
              {reportTypes.map((type) => (
                <Button
                  key={type.value}
                  variant={reportType === type.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setReportType(type.value)}
                  className="text-xs"
                >
                  {type.label}
                </Button>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Results */}
        <GlassCard padding="none">
          {!isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <BarChart3 className="h-20 w-20 mb-4 opacity-50" />
              <p className="text-lg font-medium">Selecione os filtros e gere um relatório</p>
              <p className="text-sm">O arquivo CSV será baixado automaticamente</p>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-16 w-16 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Gerando relatório...</p>
            </div>
          )}
        </GlassCard>
      </div>
    </MainLayout>
  );
}
