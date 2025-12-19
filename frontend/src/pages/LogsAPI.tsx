import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, RotateCcw, Eye, Loader2, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { apiLogsService, ApiLog } from "@/services/api";
import { format } from "date-fns";

interface LogEntry {
  id: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  statusCode: number;
  ip: string;
  date: string;
  requestPayload?: object;
  responsePayload?: object;
  userAgent?: string;
}

const methodColors: Record<string, string> = {
  GET: "bg-primary",
  POST: "bg-success",
  PATCH: "bg-warning text-warning-foreground",
  DELETE: "bg-destructive"
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function LogsAPI() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  // Data de hoje no formato YYYY-MM-DD
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const [filters, setFilters] = useState({
    endpoint: '',
    method: 'POST', // Fixo em POST
    statusCode: '',
    startDate: getTodayDate(), // Data de hoje fixa
    endDate: getTodayDate() // Data de hoje fixa
  });
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const mapApiToLocal = (apiLog: ApiLog): LogEntry => {
    // Tentar formatar a data de forma segura
    let formattedDate = '';
    try {
      if (apiLog.date) {
        const dateObj = typeof apiLog.date === 'string' ? new Date(apiLog.date) : apiLog.date;
        if (!isNaN(dateObj.getTime())) {
          formattedDate = format(dateObj, 'yyyy-MM-dd HH:mm:ss');
        } else {
          formattedDate = String(apiLog.date);
        }
      } else if (apiLog.createdAt) {
        const dateObj = typeof apiLog.createdAt === 'string' ? new Date(apiLog.createdAt) : apiLog.createdAt;
        if (!isNaN(dateObj.getTime())) {
          formattedDate = format(dateObj, 'yyyy-MM-dd HH:mm:ss');
        } else {
          formattedDate = String(apiLog.createdAt);
        }
      }
    } catch (error) {
      console.error('Error formatting date:', error);
      formattedDate = String(apiLog.date || apiLog.createdAt || '');
    }

    return {
      id: apiLog.id.toString(),
      endpoint: apiLog.endpoint,
      method: apiLog.method,
      statusCode: apiLog.statusCode,
      ip: apiLog.ip || apiLog.ipAddress || '',
      date: formattedDate,
      requestPayload: apiLog.requestPayload,
      responsePayload: apiLog.responsePayload,
      userAgent: apiLog.userAgent,
    };
  };

  const loadLogs = useCallback(async (searchParams?: {
    endpoint?: string;
    method?: string;
    statusCode?: number;
    startDate?: string;
    endDate?: string;
  }) => {
    try {
      const data = await apiLogsService.list(searchParams);
      setLogs(data.map(mapApiToLocal));
    } catch (error) {
      toast({
        title: "Erro ao carregar logs",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      // Carregar automaticamente com filtros: POST, endpoint /api/messages/*, data de hoje
      const today = getTodayDate();
      await loadLogs({
        method: 'POST',
        endpoint: '/api/messages*',
        startDate: `${today}T00:00:00.000Z`,
        endDate: `${today}T23:59:59.999Z`,
      });
      setIsLoading(false);
    };
    init();
  }, [loadLogs]);

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      const today = getTodayDate();
      const params: {
        endpoint?: string;
        method?: string;
        statusCode?: number;
        startDate?: string;
        endDate?: string;
      } = {
        method: 'POST', // Sempre POST
        endpoint: '/api/messages*', // Sempre endpoint de messages (com * para pegar todos)
        startDate: `${today}T00:00:00.000Z`,
        endDate: `${today}T23:59:59.999Z`,
      };

      if (filters.statusCode.trim()) {
        const statusCode = parseInt(filters.statusCode);
        if (!isNaN(statusCode)) {
          params.statusCode = statusCode;
        }
      }

      await loadLogs(params);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearFilters = async () => {
    const today = getTodayDate();
    setFilters({
      endpoint: '',
      method: 'POST',
      statusCode: '',
      startDate: today,
      endDate: today
    });
    setIsSearching(true);
    const todayISO = getTodayDate();
    await loadLogs({
      method: 'POST',
      endpoint: '/api/messages*',
      startDate: `${todayISO}T00:00:00.000Z`,
      endDate: `${todayISO}T23:59:59.999Z`,
    });
    setIsSearching(false);
  };

  const handleViewDetails = async (log: LogEntry) => {
    setSelectedLog(log);
    
    // If we don't have full details, fetch them
    if (!log.requestPayload && !log.responsePayload && !log.userAgent) {
      setIsLoadingDetails(true);
      try {
        const details = await apiLogsService.getById(parseInt(log.id));
        setSelectedLog(mapApiToLocal(details));
      } catch (error) {
        console.error('Error loading log details:', error);
      } finally {
        setIsLoadingDetails(false);
      }
    }
  };

  // Pagination calculations
  const totalItems = logs.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return logs.slice(startIndex, startIndex + pageSize);
  }, [logs, currentPage, pageSize]);

  const handlePageSizeChange = useCallback((value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  }, []);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('ellipsis');
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getStatusBadge = (statusCode: number) => {
    const isSuccess = statusCode >= 200 && statusCode < 300;
    return (
      <Badge className={isSuccess ? "bg-success" : "bg-destructive"}>
        {statusCode}
      </Badge>
    );
  };

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Filters */}
        <GlassCard>
          <h2 className="text-xl font-semibold text-foreground mb-6">Logs de API</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="statusCode">Status Code</Label>
              <Input
                id="statusCode"
                value={filters.statusCode}
                onChange={(e) => setFilters({ ...filters, statusCode: e.target.value })}
                placeholder="200, 404..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Data (Hoje)</Label>
              <Input
                id="startDate"
                type="date"
                value={filters.startDate}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button className="flex-1" onClick={handleSearch} disabled={isSearching}>
                {isSearching ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Buscar
              </Button>
              <Button variant="outline" size="icon" onClick={handleClearFilters} disabled={isSearching}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Filtros Ativos</Label>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">POST</Badge>
                <Badge variant="outline">/api/messages/*</Badge>
                <Badge variant="outline">Hoje</Badge>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Logs Table */}
        <GlassCard padding="none">
          <div className="p-6 border-b border-border/50">
            <h3 className="font-semibold text-foreground">Resultados</h3>
            <p className="text-sm text-muted-foreground">{logs.length} registros encontrados</p>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">Nenhum log encontrado</p>
              <p className="text-sm">Ajuste os filtros e tente novamente</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead className="w-24">Método</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="w-20 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedLogs.map((log) => (
                      <TableRow key={log.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="font-mono text-sm">{log.id}</TableCell>
                        <TableCell className="font-mono text-sm">{log.endpoint}</TableCell>
                        <TableCell>
                          <Badge className={methodColors[log.method]}>
                            {log.method}
                          </Badge>
                        </TableCell>
                        <TableCell>{getStatusBadge(log.statusCode)}</TableCell>
                        <TableCell className="font-mono text-sm">{log.ip}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.date}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleViewDetails(log)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-border/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Mostrando {startItem}-{endItem} de {totalItems}</span>
                    <span className="hidden sm:inline">|</span>
                    <div className="flex items-center gap-2">
                      <span className="hidden sm:inline">Por página:</span>
                      <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                        <SelectTrigger className="w-[70px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem key={size} value={String(size)}>
                              {size}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    
                    {pageNumbers.map((page, index) => (
                      page === 'ellipsis' ? (
                        <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">...</span>
                      ) : (
                        <Button
                          key={page}
                          variant={currentPage === page ? "default" : "outline"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => goToPage(page)}
                        >
                          {page}
                        </Button>
                      )
                    ))}
                    
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </GlassCard>
      </div>

      {/* Log Details Modal */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Detalhes do Log</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="max-h-[60vh]">
              {isLoadingDetails ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-6 py-4">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">ID</Label>
                      <p className="font-mono">{selectedLog.id}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Data</Label>
                      <p>{selectedLog.date}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Endpoint</Label>
                      <p className="font-mono">{selectedLog.endpoint}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">IP</Label>
                      <p className="font-mono">{selectedLog.ip}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Método</Label>
                      <Badge className={methodColors[selectedLog.method]}>{selectedLog.method}</Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Status</Label>
                      {getStatusBadge(selectedLog.statusCode)}
                    </div>
                  </div>

                  {/* Request Payload */}
                  {selectedLog.requestPayload && (
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Request Payload</Label>
                      <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono">
                        {JSON.stringify(selectedLog.requestPayload, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Response Payload */}
                  {selectedLog.responsePayload && (
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Response Payload</Label>
                      <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono">
                        {JSON.stringify(selectedLog.responsePayload, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* User Agent */}
                  {selectedLog.userAgent && (
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">User Agent</Label>
                      <p className="text-sm text-muted-foreground break-all">{selectedLog.userAgent}</p>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
