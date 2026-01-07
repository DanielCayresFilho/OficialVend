import { useState, useEffect, useCallback } from "react";
import { BarChart3, Download, Loader2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const [reportGenerated, setReportGenerated] = useState(false);
  const [reportBlob, setReportBlob] = useState<Blob | null>(null);
  const [mockDataEnabled] = useState(useMockData());
  const [mockReportData, setMockReportData] = useState<any>(null);

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

  // Resetar dados quando mudar o tipo de relatório
  useEffect(() => {
    setReportGenerated(false);
    setReportBlob(null);
    setMockReportData(null);
  }, [reportType]);

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
    setReportGenerated(false);
    setReportBlob(null);
    setMockReportData(null);

    try {
      // Se mock data estiver ativado, usar dados mockados
      if (mockDataEnabled) {
        // Simular delay de carregamento
        await new Promise(resolve => setTimeout(resolve, 1000));

        const mockData = getMockDataForReportType(reportType);
        if (mockData) {
          setMockReportData(mockData);
          setReportGenerated(true);
          toast({
            title: "Relatório mockado gerado",
            description: "Dados de apresentação carregados com sucesso",
          });
        } else {
          toast({
            title: "Mock não disponível",
            description: "Este tipo de relatório ainda não tem dados mockados",
            variant: "destructive",
          });
        }
      } else {
        // Usar dados reais da API
        const blob = await reportsService.generate({
          startDate,
          endDate,
          segment: segment && segment !== 'all' ? parseInt(segment) : undefined,
          type: reportType,
        });

        setReportBlob(blob);
        setReportGenerated(true);
        toast({
          title: "Relatório gerado",
          description: "O relatório foi gerado com sucesso",
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

  const handleExport = () => {
    if (mockDataEnabled && mockReportData) {
      // Exportar dados mockados como CSV
      const csvContent = convertMockDataToCSV(mockReportData, reportType);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio_mockado_${reportType}_${startDate}_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download iniciado",
        description: "Arquivo mockado sendo baixado",
      });
    } else if (reportBlob) {
      // Exportar dados reais
      const url = URL.createObjectURL(reportBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio_${reportType}_${startDate}_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download iniciado",
        description: "O arquivo está sendo baixado",
      });
    }
  };

  const getSelectedReportLabel = () => {
    return reportTypes.find(r => r.value === reportType)?.label || '';
  };

  const renderMockDataPreview = () => {
    if (!mockReportData) return null;

    switch (reportType) {
      case 'envios':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Resumo de Envios</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Enviados</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.total.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-success/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Sucesso</p>
                  <p className="text-2xl font-bold text-success">{mockReportData.resumo.sucesso.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-destructive/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Falha</p>
                  <p className="text-2xl font-bold text-destructive">{mockReportData.resumo.falha.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Taxa Sucesso</p>
                  <p className="text-2xl font-bold text-blue-500">{mockReportData.resumo.taxaSucesso}%</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Por Dia</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Enviados</TableHead>
                    <TableHead>Sucesso</TableHead>
                    <TableHead>Falha</TableHead>
                    <TableHead>Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockReportData.porDia.map((row: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{row.data}</TableCell>
                      <TableCell>{row.enviados}</TableCell>
                      <TableCell className="text-success">{row.sucesso}</TableCell>
                      <TableCell className="text-destructive">{row.falha}</TableCell>
                      <TableCell>{row.taxaSucesso}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      case 'indicadores':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Visão Geral</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Conversas Ativas</p>
                  <p className="text-2xl font-bold">{mockReportData.visaoGeral.conversasAtivas}</p>
                </div>
                <div className="p-4 bg-success/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Finalizadas</p>
                  <p className="text-2xl font-bold">{mockReportData.visaoGeral.conversasFinalizadas}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Tempo Médio</p>
                  <p className="text-2xl font-bold">{mockReportData.visaoGeral.tempoMedioResposta}</p>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Taxa Conversão</p>
                  <p className="text-2xl font-bold">{mockReportData.visaoGeral.taxaConversao}%</p>
                </div>
                <div className="p-4 bg-yellow-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Satisfação</p>
                  <p className="text-2xl font-bold">{mockReportData.visaoGeral.satisfacaoCliente}/5</p>
                </div>
                <div className="p-4 bg-green-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">NPS</p>
                  <p className="text-2xl font-bold">{mockReportData.visaoGeral.nps}</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Tabulações</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tabulação</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Percentual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockReportData.tabulacoes.map((tab: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{tab.nome}</TableCell>
                      <TableCell>{tab.quantidade}</TableCell>
                      <TableCell>{tab.percentual}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      case 'kpi':
        return (
          <div className="space-y-6">
            <h3 className="font-semibold text-lg mb-4">KPIs Principais</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>KPI</TableHead>
                  <TableHead>Atual</TableHead>
                  <TableHead>Meta</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Variação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockReportData.principais.map((kpi: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{kpi.nome}</TableCell>
                    <TableCell>{kpi.valor}</TableCell>
                    <TableCell>{kpi.meta}</TableCell>
                    <TableCell>{kpi.unidade}</TableCell>
                    <TableCell className={kpi.tendencia === 'up' ? 'text-success' : 'text-destructive'}>
                      {kpi.variacao}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );

      case 'hsm':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Resumo Templates</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Templates Ativos</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.templatesAtivos}</p>
                </div>
                <div className="p-4 bg-success/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Aprovados</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.templatesAprovados}</p>
                </div>
                <div className="p-4 bg-yellow-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Pendentes</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.templatesPendentes}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Envios 30d</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.enviosUltimos30Dias.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Templates</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Envios</TableHead>
                    <TableHead>Entregues</TableHead>
                    <TableHead>Lidos</TableHead>
                    <TableHead>Taxa Leitura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockReportData.templates.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.nome}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${t.status === 'APPROVED' ? 'bg-success/10 text-success' : 'bg-yellow-500/10 text-yellow-500'}`}>
                          {t.status}
                        </span>
                      </TableCell>
                      <TableCell>{t.categoria}</TableCell>
                      <TableCell>{t.envios}</TableCell>
                      <TableCell>{t.entregues}</TableCell>
                      <TableCell>{t.lidos}</TableCell>
                      <TableCell>{t.taxa_leitura}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      case 'status_linha':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Resumo Linhas</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.totalLinhas}</p>
                </div>
                <div className="p-4 bg-success/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Ativas</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.ativas}</p>
                </div>
                <div className="p-4 bg-destructive/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Banidas</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.banidas}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Em Uso</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.emUso}</p>
                </div>
                <div className="p-4 bg-green-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Taxa Uso</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.taxaUso}%</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Linhas (mostrando primeiras 10)</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Segmento</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Msgs Hoje</TableHead>
                    <TableHead>% Uso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockReportData.linhas.slice(0, 10).map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.telefone}</TableCell>
                      <TableCell>{l.nome}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${l.status === 'active' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          {l.status}
                        </span>
                      </TableCell>
                      <TableCell>{l.segmento}</TableCell>
                      <TableCell>{l.operador_atual || 'N/A'}</TableCell>
                      <TableCell>{l.mensagens_hoje}</TableCell>
                      <TableCell>{l.percentual_uso}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      case 'tempos':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Tempos Médios</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Resposta</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.tempoMedioResposta}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">1ª Resposta</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.tempoMedioPrimeiraResposta}</p>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Atendimento</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.tempoMedioAtendimento}</p>
                </div>
                <div className="p-4 bg-yellow-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Espera</p>
                  <p className="text-2xl font-bold">{mockReportData.resumo.tempoMedioEspera}</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Por Operador</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operador</TableHead>
                    <TableHead>Tmp Resposta</TableHead>
                    <TableHead>Tmp 1ª Resp</TableHead>
                    <TableHead>Tmp Atend</TableHead>
                    <TableHead>Atendimentos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockReportData.porOperador.map((op: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{op.operador}</TableCell>
                      <TableCell>{op.tmpResposta}</TableCell>
                      <TableCell>{op.tmpPrimeiraResp}</TableCell>
                      <TableCell>{op.tmpAtendimento}</TableCell>
                      <TableCell>{op.atendimentos}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      case 'op_sintetico':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Operacional Sintético - Produção Hoje</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Conversas Iniciadas</p>
                  <p className="text-2xl font-bold">{mockReportData.producao.conversasIniciadasHoje}</p>
                </div>
                <div className="p-4 bg-success/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Finalizadas</p>
                  <p className="text-2xl font-bold">{mockReportData.producao.conversasFinalizadasHoje}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Msgs Enviadas</p>
                  <p className="text-2xl font-bold">{mockReportData.producao.mensagensEnviadasHoje}</p>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Msgs Recebidas</p>
                  <p className="text-2xl font-bold">{mockReportData.producao.mensagensRecebidasHoje}</p>
                </div>
                <div className="p-4 bg-yellow-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Templates</p>
                  <p className="text-2xl font-bold">{mockReportData.producao.templatesEnviadosHoje}</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Ranking de Operadores</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operador</TableHead>
                    <TableHead>Conversas</TableHead>
                    <TableHead>Mensagens</TableHead>
                    <TableHead>Tempo Médio</TableHead>
                    <TableHead>Satisfação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockReportData.ranking.map((op: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{op.operador}</TableCell>
                      <TableCell>{op.conversas}</TableCell>
                      <TableCell>{op.mensagens}</TableCell>
                      <TableCell>{op.tempo_medio}</TableCell>
                      <TableCell>{op.satisfacao}/5</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      default:
        return (
          <div className="p-6 text-center text-muted-foreground">
            <p>Preview não disponível para este tipo de relatório</p>
            <p className="text-sm mt-2">Use o botão "Baixar CSV" para exportar os dados</p>
          </div>
        );
    }
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
          {!reportGenerated && !isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <BarChart3 className="h-20 w-20 mb-4 opacity-50" />
              <p className="text-lg font-medium">Selecione os filtros e gere um relatório</p>
              <p className="text-sm">Os dados serão exibidos aqui</p>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-16 w-16 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Gerando relatório...</p>
            </div>
          )}

          {reportGenerated && (mockReportData || reportBlob) && (
            <div className="p-6">
              {mockDataEnabled && mockReportData && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-foreground text-lg">
                      {getSelectedReportLabel()}
                    </h3>
                    <Button onClick={handleExport} size="sm">
                      <Download className="mr-2 h-4 w-4" />
                      Baixar CSV
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    Período: {startDate} até {endDate}
                  </p>
                  <div className="border rounded-lg p-6">
                    {renderMockDataPreview()}
                  </div>
                </div>
              )}

              {!mockDataEnabled && reportBlob && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
                    <BarChart3 className="h-8 w-8 text-success" />
                  </div>
                  <h3 className="font-semibold text-foreground text-lg mb-2">
                    Relatório Gerado com Sucesso!
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6 text-center">
                    Relatório: <strong>{getSelectedReportLabel()}</strong><br />
                    Período: {startDate} até {endDate}
                  </p>
                  <Button onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    Baixar CSV
                  </Button>
                </div>
              )}
            </div>
          )}
        </GlassCard>
      </div>
    </MainLayout>
  );
}
