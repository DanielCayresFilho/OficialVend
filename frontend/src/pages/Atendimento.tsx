import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Send, FileText, MessageCircle, ArrowRight, ArrowLeft, Loader2, Wifi, WifiOff, Edit, UserCheck, X, Check, Phone, AlertTriangle, RefreshCw, Search, Menu, Download, Trash2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { toast } from "@/hooks/use-toast";
import { conversationsService, tabulationsService, contactsService, templatesService, linesService, usersService, Contact, Conversation as APIConversation, Tabulation, Template, getAuthToken } from "@/services/api";
import { useRealtimeConnection, useRealtimeSubscription } from "@/hooks/useRealtimeConnection";
import { WS_EVENTS, realtimeSocket } from "@/services/websocket";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";

interface ConversationGroup {
  contactPhone: string;
  contactName: string;
  lastMessage: string;
  lastMessageTime: string;
  isFromContact: boolean;
  unread?: boolean;
  messages: APIConversation[];
  isTabulated?: boolean; // Indica se a conversa foi tabulada
}

export default function Atendimento() {
  const { user } = useAuth();

  // API Base URL
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const [selectedConversation, setSelectedConversation] = useState<ConversationGroup | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);
  const [tabulations, setTabulations] = useState<Tabulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [messageText, setMessageText] = useState<string>("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactCpf, setNewContactCpf] = useState("");
  const [newContactContract, setNewContactContract] = useState("");
  const [newContactTemplateId, setNewContactTemplateId] = useState<string>("");
  const [availableLines, setAvailableLines] = useState<any[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string>("");
  const [isLoadingLines, setIsLoadingLines] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [availableOperators, setAvailableOperators] = useState<any[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>("");
  const [isLoadingOperators, setIsLoadingOperators] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { playMessageSound, playSuccessSound, playErrorSound } = useNotificationSound();
  const { isConnected: isRealtimeConnected } = useRealtimeConnection();
  
  // Estado para edição de contato
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editContactCpf, setEditContactCpf] = useState("");
  const [editContactContract, setEditContactContract] = useState("");
  const [editContactIsCPC, setEditContactIsCPC] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const previousConversationsRef = useRef<ConversationGroup[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  
  // Estado para filtro de conversas
  type FilterType = 'todas' | 'stand-by' | 'atendimento' | 'finalizadas';
  const [conversationFilter, setConversationFilter] = useState<FilterType>('todas');
  
  // Estado para pesquisa de tabulação
  const [tabulationSearch, setTabulationSearch] = useState("");
  
  // Estado para notificação de linha banida
  const [lineBannedNotification, setLineBannedNotification] = useState<{
    bannedLinePhone: string;
    newLinePhone: string | null;
    contactsToRecall: Array<{ phone: string; name: string }>;
    message: string;
  } | null>(null);
  const [isRecallingContact, setIsRecallingContact] = useState<string | null>(null);
  
  // Estado para controlar visibilidade da sidebar em mobile
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Estado para deletar conversa
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);

  // Subscribe to new messages in real-time
  useRealtimeSubscription(WS_EVENTS.NEW_MESSAGE, (data: any) => {
    console.log('[Atendimento] New message received:', data);
    
    if (data.message) {
      const newMsg = data.message as APIConversation;
      
      // Play sound for incoming messages
      if (newMsg.sender === 'contact') {
        playMessageSound();
      }
      
      setConversations(prev => {
        const existing = prev.find(c => c.contactPhone === newMsg.contactPhone);
        
        if (existing) {
          // Add message to existing conversation
          const updated = prev.map(conv => {
            if (conv.contactPhone === newMsg.contactPhone) {
              return {
                ...conv,
                messages: [...conv.messages, newMsg].sort((a, b) => 
                  new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
                ),
                lastMessage: newMsg.message,
                lastMessageTime: newMsg.datetime,
                isFromContact: newMsg.sender === 'contact',
              };
            }
            return conv;
          });
          return updated.sort((a, b) => 
            new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
          );
        } else {
          // Create new conversation group
          const newGroup: ConversationGroup = {
            contactPhone: newMsg.contactPhone,
            contactName: newMsg.contactName,
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: newMsg.sender === 'contact',
            messages: [newMsg],
            unread: true,
          };
          return [newGroup, ...prev];
        }
      });

      // Update selected conversation if it's the same contact (usando ref)
      if (selectedPhoneRef.current === newMsg.contactPhone) {
        setSelectedConversation(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, newMsg].sort((a, b) => 
              new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
            ),
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: newMsg.sender === 'contact',
          };
        });
      }
    }
  }, [playMessageSound]); // Removido selectedConversation da dependência

  // Subscribe to message sent confirmation
  useRealtimeSubscription('message-sent', (data: any) => {
    console.log('[Atendimento] Message sent confirmation:', data);
    if (data?.message) {
      // Adicionar mensagem à conversa ativa
      const newMsg = data.message as APIConversation;
      
      // Mostrar toast de sucesso
      playSuccessSound();
      toast({
        title: "Mensagem enviada",
        description: "Sua mensagem foi enviada com sucesso",
      });
      
      // Se estava criando nova conversa, fechar dialog e limpar campos
      if (isNewConversationOpen) {
        closeNewConversationModal();
      }
      
      setConversations(prev => {
        const existing = prev.find(c => c.contactPhone === newMsg.contactPhone);
        
        if (existing) {
          return prev.map(conv => {
            if (conv.contactPhone === newMsg.contactPhone) {
              return {
                ...conv,
                messages: [...conv.messages, newMsg].sort((a, b) => 
                  new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
                ),
                lastMessage: newMsg.message,
                lastMessageTime: newMsg.datetime,
                isFromContact: false,
              };
            }
            return conv;
          }).sort((a, b) => 
            new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
          );
        } else {
          // Nova conversa criada
          const newGroup: ConversationGroup = {
            contactPhone: newMsg.contactPhone,
            contactName: newMsg.contactName,
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: false,
            messages: [newMsg],
          };
          return [newGroup, ...prev];
        }
      });

      // Atualizar conversa selecionada se for a mesma (usando ref)
      if (selectedPhoneRef.current === newMsg.contactPhone) {
        setSelectedConversation(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, newMsg].sort((a, b) => 
              new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
            ),
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
          };
        });
      }
    }
  }, [playSuccessSound, isNewConversationOpen]);

  // Subscribe to message errors (bloqueios CPC, repescagem, etc)
  useRealtimeSubscription('message-error', (data: any) => {
    console.log('[Atendimento] Message error received:', data);
    if (data?.error) {
      playErrorSound();
      
      // Determinar título baseado no tipo de erro
      let title = "Mensagem bloqueada";
      if (data.error.includes('CPC')) {
        title = "Bloqueio de CPC";
      } else if (data.error.includes('repescagem') || data.error.includes('Aguarde')) {
        title = "Bloqueio de Repescagem";
      } else if (data.error.includes('permissão')) {
        title = "Sem permissão";
      }
      
      toast({
        title,
        description: data.error,
        variant: "destructive",
        duration: data.hoursRemaining ? 8000 : 5000, // Mostrar por mais tempo se tiver horas restantes
      });
    }
  }, [playErrorSound]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Ref para armazenar o contactPhone selecionado (evita loop infinito)
  const selectedPhoneRef = useRef<string | null>(null);

  // Atualizar ref quando selectedConversation mudar
  useEffect(() => {
    selectedPhoneRef.current = selectedConversation?.contactPhone || null;
  }, [selectedConversation?.contactPhone]);

  const loadConversations = useCallback(async () => {
    try {
      // Carregar tanto conversas ativas quanto tabuladas para ter todos os dados
      const [activeData, tabulatedData] = await Promise.all([
        conversationsService.getActive(),
        conversationsService.getTabulated().catch(() => []), // Se falhar, retorna array vazio
      ]);
      
      // Combinar todos os dados
      const allData = [...activeData, ...tabulatedData];
      
      // Group conversations by contact phone
      const groupedMap = new Map<string, ConversationGroup>();
      
      allData.forEach((conv) => {
        const existing = groupedMap.get(conv.contactPhone);
        const isTabulated = conv.tabulation !== null && conv.tabulation !== undefined;
        
        if (existing) {
          existing.messages.push(conv);
          // Update last message if this one is more recent
          const convTime = new Date(conv.datetime).getTime();
          const existingTime = new Date(existing.lastMessageTime).getTime();
          if (convTime > existingTime) {
            existing.lastMessage = conv.message;
            existing.lastMessageTime = conv.datetime;
            existing.isFromContact = conv.sender === 'contact';
            existing.isTabulated = isTabulated;
          }
          // Se qualquer mensagem for tabulada, a conversa é tabulada
          if (isTabulated) {
            existing.isTabulated = true;
          }
        } else {
          groupedMap.set(conv.contactPhone, {
            contactPhone: conv.contactPhone,
            contactName: conv.contactName,
            lastMessage: conv.message,
            lastMessageTime: conv.datetime,
            isFromContact: conv.sender === 'contact',
            isTabulated: isTabulated,
            messages: [conv],
          });
        }
      });

      // Sort messages within each group and groups by last message time
      let groups = Array.from(groupedMap.values()).map(group => ({
        ...group,
        messages: group.messages.sort((a, b) => 
          new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
        ),
      })).sort((a, b) => 
        new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
      );

      // Aplicar filtro
      if (conversationFilter !== 'todas') {
        groups = groups.filter(group => {
          if (conversationFilter === 'finalizadas') {
            return group.isTabulated === true;
          }
          // Para stand-by e atendimento, só mostrar não tabuladas
          if (group.isTabulated === true) {
            return false;
          }
          if (conversationFilter === 'stand-by') {
            // Stand By: última mensagem foi do operador (aguardando resposta do cliente)
            return group.isFromContact === false;
          }
          if (conversationFilter === 'atendimento') {
            // Atendimento: última mensagem foi do cliente (aguardando resposta do operador)
            return group.isFromContact === true;
          }
          return true;
        });
      }

      setConversations(groups);
      
      // Update selected conversation if it exists (usando ref para evitar loop)
      const currentSelectedPhone = selectedPhoneRef.current;
      if (currentSelectedPhone) {
        const updated = groups.find(g => g.contactPhone === currentSelectedPhone);
        if (updated) {
          setSelectedConversation(updated);
        }
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setIsLoading(false);
    }
  }, [conversationFilter]); // Adicionar conversationFilter como dependência

  // Subscribe to line reallocation (depois de loadConversations estar definido)
  useRealtimeSubscription('line-reallocated', (data: any) => {
    console.log('[Atendimento] Line reallocated:', data);
    if (data?.newLinePhone) {
      playSuccessSound();
      toast({
        title: "Linha realocada",
        description: data.message || `Nova linha ${data.newLinePhone} foi atribuída automaticamente.`,
        duration: 8000,
      });
      
      // Recarregar conversas para atualizar com a nova linha
      setTimeout(() => {
        loadConversations();
      }, 1000);
    }
  }, [playSuccessSound, loadConversations]);

  const loadTabulations = useCallback(async () => {
    try {
      const data = await tabulationsService.list();
      setTabulations(data);
    } catch (error) {
      console.error('Error loading tabulations:', error);
    }
  }, []);

  // Carregar dados do contato para edição
  const openEditContact = useCallback(async () => {
    if (!selectedConversation) return;
    
    try {
      const contact = await contactsService.getByPhone(selectedConversation.contactPhone);
      if (contact) {
        setEditingContact(contact);
        setEditContactName(contact.name);
        setEditContactCpf(contact.cpf || "");
        setEditContactContract(contact.contract || "");
        setEditContactIsCPC(contact.isCPC || false);
        setIsEditContactOpen(true);
      } else {
        // Contato não existe, criar com dados básicos
        setEditingContact(null);
        setEditContactName(selectedConversation.contactName);
        setEditContactCpf("");
        setEditContactContract("");
        setEditContactIsCPC(false);
        setIsEditContactOpen(true);
      }
    } catch (error) {
      console.error('Error loading contact:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados do contato",
        variant: "destructive",
      });
    }
  }, [selectedConversation]);

  // Salvar alterações do contato
  const handleSaveContact = useCallback(async () => {
    if (!selectedConversation) return;
    
    setIsSavingContact(true);
    try {
      const updateData = {
        name: editContactName.trim(),
        cpf: editContactCpf.trim() || undefined,
        contract: editContactContract.trim() || undefined,
        isCPC: editContactIsCPC,
      };

      if (editingContact) {
        await contactsService.updateByPhone(selectedConversation.contactPhone, updateData);
      } else {
        // Criar contato se não existir
        await contactsService.create({
          name: editContactName.trim(),
          phone: selectedConversation.contactPhone,
          cpf: editContactCpf.trim() || undefined,
          contract: editContactContract.trim() || undefined,
          isCPC: editContactIsCPC,
          segment: user?.segmentId,
        });
      }

      // Atualizar nome na conversa selecionada
      if (editContactName.trim() !== selectedConversation.contactName) {
        setSelectedConversation(prev => prev ? {
          ...prev,
          contactName: editContactName.trim(),
        } : null);

        // Atualizar na lista de conversas
        setConversations(prev => prev.map(c => 
          c.contactPhone === selectedConversation.contactPhone 
            ? { ...c, contactName: editContactName.trim() }
            : c
        ));
      }

      playSuccessSound();
      toast({
        title: "Contato atualizado",
        description: editContactIsCPC ? "Contato marcado como CPC" : "Dados salvos com sucesso",
      });
      setIsEditContactOpen(false);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro ao salvar contato",
        variant: "destructive",
      });
    } finally {
      setIsSavingContact(false);
    }
  }, [selectedConversation, editingContact, editContactName, editContactCpf, editContactContract, editContactIsCPC, user, playSuccessSound, playErrorSound]);

  const loadTemplates = useCallback(async () => {
    if (!user?.segmentId) return;
    setIsLoadingTemplates(true);
    try {
      const data = await templatesService.getBySegment(user.segmentId);
      setTemplates(data.filter(t => t.status === 'APPROVED')); // Apenas templates aprovados
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, [user?.segmentId]);

  // Carregar templates filtrados pela linha selecionada
  const loadTemplatesByLine = useCallback(async (lineId: string) => {
    if (!lineId) return;
    setIsLoadingTemplates(true);
    try {
      const data = await templatesService.getByLine(parseInt(lineId));
      setTemplates(data.filter(t => t.status === 'APPROVED')); // Apenas templates aprovados
    } catch (error) {
      console.error('Error loading templates by line:', error);
      toast({
        title: "Erro ao carregar templates",
        description: "Não foi possível carregar os templates desta linha",
        variant: "destructive",
      });
    } finally {
      setIsLoadingTemplates(false);
    }
  }, []);

  const loadAvailableLines = useCallback(async () => {
    if (!user?.segmentId) return;
    setIsLoadingLines(true);
    try {
      const data = await linesService.getBySegment(user.segmentId);
      setAvailableLines(data);
      // Selecionar primeira linha por padrão se não tiver nenhuma selecionada
      if (data.length > 0) {
        setSelectedLineId(prev => prev || data[0].id.toString());
      }
    } catch (error) {
      console.error('Error loading lines:', error);
      toast({
        title: "Erro ao carregar linhas",
        description: "Não foi possível carregar as linhas disponíveis",
        variant: "destructive",
      });
    } finally {
      setIsLoadingLines(false);
    }
  }, [user?.segmentId]);

  useEffect(() => {
    loadConversations();
    loadTabulations();
    loadTemplates();
  }, [loadConversations, loadTabulations, loadTemplates]);

  // Carregar linhas disponíveis quando o modal abrir
  useEffect(() => {
    if (isNewConversationOpen && user?.segmentId) {
      const loadLines = async () => {
        setIsLoadingLines(true);
        try {
          const data = await linesService.getBySegment(user.segmentId);
          setAvailableLines(data);
          // Selecionar primeira linha por padrão se não tiver nenhuma selecionada
          if (data.length > 0 && !selectedLineId) {
            setSelectedLineId(data[0].id.toString());
          }
        } catch (error) {
          console.error('Error loading lines:', error);
          toast({
            title: "Erro ao carregar linhas",
            description: "Não foi possível carregar as linhas disponíveis",
            variant: "destructive",
          });
        } finally {
          setIsLoadingLines(false);
        }
      };
      loadLines();
    }
  }, [isNewConversationOpen, user?.segmentId, selectedLineId]);

  // Carregar templates quando linha mudar no modal de nova conversa
  useEffect(() => {
    if (selectedLineId && isNewConversationOpen) {
      const loadTemplates = async () => {
        setIsLoadingTemplates(true);
        try {
          const data = await templatesService.getByLine(parseInt(selectedLineId));
          setTemplates(data.filter(t => t.status === 'APPROVED'));
        } catch (error) {
          console.error('Error loading templates by line:', error);
          toast({
            title: "Erro ao carregar templates",
            description: "Não foi possível carregar os templates desta linha",
            variant: "destructive",
          });
        } finally {
          setIsLoadingTemplates(false);
        }
      };
      loadTemplates();
    }
  }, [selectedLineId, isNewConversationOpen]);

  // Detectar desconexão do WebSocket e sugerir atualização
  useEffect(() => {
    if (!isRealtimeConnected) {
      // Mostrar toast informando sobre desconexão após 5 segundos
      const timeout = setTimeout(() => {
        toast({
          title: "Conexão perdida",
          description: "A conexão com o servidor foi perdida. Atualize a página para reconectar.",
          variant: "destructive",
          duration: 10000,
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Atualizar
            </Button>
          ),
        });
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [isRealtimeConnected]);

  // Poll for new messages only if WebSocket not connected
  useEffect(() => {
    if (isRealtimeConnected) {
      console.log('[Atendimento] WebSocket connected, polling disabled');
      return;
    }

    console.log('[Atendimento] WebSocket not connected, using polling fallback');
    const interval = setInterval(() => {
      loadConversations();
    }, 5000);

    return () => clearInterval(interval);
  }, [loadConversations, isRealtimeConnected]);

  useEffect(() => {
    scrollToBottom();
  }, [selectedConversation?.messages]);

  // Função para determinar o tipo de mídia baseado no mimetype
  const getMessageTypeFromMime = (mimeType: string): 'image' | 'video' | 'audio' | 'document' => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  };

  // Função para fazer upload de arquivo
  const handleFileUpload = useCallback(async (file: File) => {
    if (!selectedConversation || isUploadingFile) return;

    setIsUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getAuthToken();
      if (!token) {
        throw new Error('Não autenticado');
      }

      const response = await fetch(`${API_BASE_URL}/media/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Erro ao fazer upload do arquivo');
      }

      const data = await response.json();
      const messageType = getMessageTypeFromMime(data.mimeType);
      const mediaUrl = data.mediaUrl.startsWith('http') ? data.mediaUrl : `${API_BASE_URL}${data.mediaUrl}`;

      // Upload de arquivo removido - no 1x1 apenas templates podem ser enviados
      toast({
        title: "Upload não disponível",
        description: "No 1x1, apenas templates podem ser enviados",
        variant: "default",
      });
      toast({
        title: "Arquivo enviado",
        description: "Arquivo enviado com sucesso",
      });
    } catch (error) {
      console.error('Erro ao fazer upload:', error);
      playErrorSound();
      toast({
        title: "Erro ao enviar arquivo",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsUploadingFile(false);
      // Limpar input de arquivo
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [selectedConversation, isUploadingFile, isRealtimeConnected, playErrorSound]);

  // Handler para seleção de arquivo
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  // Verificar se pode enviar mensagem livre (não precisa de template)
  const canSendFreeMessage = useCallback((conversation: ConversationGroup | null): boolean => {
    if (!conversation) return false;
    
    // Verificar se há mensagens do operador na conversa
    const hasOperatorMessages = conversation.messages.some(msg => msg.sender === 'operator');
    
    // Verificar se a conversa foi iniciada pelo cliente (primeira mensagem é do cliente)
    const isInbound = conversation.messages.length > 0 && conversation.messages[0]?.sender === 'contact';
    
    // Pode enviar mensagem livre se:
    // 1. Já há mensagens do operador (não é primeira mensagem), OU
    // 2. A conversa foi iniciada pelo cliente (inbound - janela de 24h da Meta)
    return hasOperatorMessages || isInbound;
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!messageText.trim() || !selectedConversation || isSending) {
      if (!messageText.trim()) {
        toast({
          title: "Mensagem vazia",
          description: "Digite uma mensagem para enviar",
          variant: "destructive",
        });
      }
      return;
    }

    // Verificar se pode enviar mensagem livre
    if (!canSendFreeMessage(selectedConversation)) {
      toast({
        title: "Template obrigatório",
        description: "A primeira mensagem deve ser um template aprovado",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);

    try {
      // Enviar mensagem livre via WebSocket
      realtimeSocket.emit('send-message', {
        contactPhone: selectedConversation.contactPhone,
        message: messageText.trim(),
        messageType: 'text',
        isNewConversation: false, // Já existe conversa
      });

      setMessageText(""); // Limpar campo
      playSuccessSound();
      
      // Recarregar conversas após um pequeno delay para garantir que a mensagem foi processada
      setTimeout(() => {
        loadConversations();
      }, 500);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao enviar mensagem",
        description: error instanceof Error ? error.message : "Erro ao enviar mensagem",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }, [messageText, selectedConversation, isSending, canSendFreeMessage, playSuccessSound, playErrorSound, loadConversations]);

  const handleSendTemplate = useCallback(async () => {
    if (!selectedTemplateId || !selectedConversation || isSending) {
      if (!selectedTemplateId) {
        toast({
          title: "Template obrigatório",
          description: "Selecione um template para enviar",
          variant: "destructive",
        });
      }
      return;
    }

    // Obter linha da conversa atual
    const conversationLine = selectedConversation.messages.find(m => m.userLine)?.userLine;
    if (!conversationLine) {
      toast({
        title: "Erro",
        description: "Não foi possível identificar a linha desta conversa",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);

    try {
      // Enviar template via API REST (templates são enviados via API, não WebSocket)
      await templatesService.send({
        templateId: parseInt(selectedTemplateId),
        phone: selectedConversation.contactPhone,
        contactName: selectedConversation.contactName,
        lineId: conversationLine,
      });

      playSuccessSound();
      toast({
        title: "Template enviado",
        description: "Template enviado com sucesso",
      });

      setSelectedTemplateId(""); // Limpar seleção
      await loadConversations();
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao enviar template",
        description: error instanceof Error ? error.message : "Erro ao enviar template",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }, [selectedTemplateId, selectedConversation, isSending, playSuccessSound, playErrorSound, loadConversations]);

  const handleTabulate = useCallback(async (tabulationId: number) => {
    if (!selectedConversation) return;

    try {
      await conversationsService.tabulate(selectedConversation.contactPhone, tabulationId);
      playSuccessSound();
      toast({
        title: "Conversa tabulada",
        description: "A conversa foi tabulada com sucesso",
      });
      
      // Remove from active conversations
      setConversations(prev => prev.filter(c => c.contactPhone !== selectedConversation.contactPhone));
      setSelectedConversation(null);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao tabular",
        description: error instanceof Error ? error.message : "Erro ao tabular conversa",
        variant: "destructive",
      });
    }
  }, [selectedConversation, playSuccessSound, playErrorSound]);

  // Carregar operadores quando o dialog de transferência abrir
  useEffect(() => {
    if (isTransferDialogOpen && selectedConversation) {
      const loadOperators = async () => {
        setIsLoadingOperators(true);
        try {
          // Buscar operadores online do mesmo segmento
          const segment = user?.segment || selectedConversation.messages[0]?.segment;
          const operators = await usersService.getOnlineOperators(segment || undefined);
          // Filtrar o operador atual se houver
          const filtered = operators.filter(op => op.id !== user?.id);
          setAvailableOperators(filtered);
        } catch (error) {
          console.error('Erro ao carregar operadores:', error);
          toast({
            title: "Erro ao carregar operadores",
            description: "Não foi possível carregar a lista de operadores",
            variant: "destructive",
          });
        } finally {
          setIsLoadingOperators(false);
        }
      };
      loadOperators();
    }
  }, [isTransferDialogOpen, selectedConversation, user]);

  const handleTransfer = useCallback(async () => {
    if (!selectedConversation || !selectedOperatorId) {
      toast({
        title: "Operador não selecionado",
        description: "Selecione um operador para transferir a conversa",
        variant: "destructive",
      });
      return;
    }

    try {
      // Usar o ID da primeira mensagem da conversa para transferir
      const firstMessage = selectedConversation.messages[0];
      if (!firstMessage) {
        toast({
          title: "Erro",
          description: "Não foi possível identificar a conversa",
          variant: "destructive",
        });
        return;
      }

      await conversationsService.transfer(firstMessage.id, parseInt(selectedOperatorId));
      
      playSuccessSound();
      toast({
        title: "Conversa transferida",
        description: "A conversa foi transferida com sucesso",
      });
      
      // Fechar dialog e limpar seleção
      setIsTransferDialogOpen(false);
      setSelectedOperatorId("");
      
      // Remover conversa da lista atual (ela será atribuída ao novo operador)
      setConversations(prev => prev.filter(c => c.contactPhone !== selectedConversation.contactPhone));
      setSelectedConversation(null);
      
      // Recarregar conversas após um delay
      setTimeout(() => {
        loadConversations();
      }, 500);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao transferir",
        description: error instanceof Error ? error.message : "Erro ao transferir conversa",
        variant: "destructive",
      });
    }
  }, [selectedConversation, selectedOperatorId, playSuccessSound, playErrorSound, loadConversations, user]);

  // Função para deletar conversa (apenas admin e digital)
  const handleDeleteConversation = useCallback(async () => {
    if (!selectedConversation) return;
    if (isDeletingConversation) return;

    // Confirmação antes de deletar
    const confirmed = window.confirm(
      `Tem certeza que deseja deletar TODAS as mensagens do contato ${selectedConversation.contactName} (${selectedConversation.contactPhone})?\n\nEsta ação não pode ser desfeita!`
    );

    if (!confirmed) return;

    setIsDeletingConversation(true);
    try {
      const token = getAuthToken();
      if (!token) {
        throw new Error('Não autenticado');
      }

      const response = await fetch(`${API_BASE_URL}/conversations/contact/${encodeURIComponent(selectedConversation.contactPhone)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Erro ao deletar conversa');
      }

      const result = await response.json();

      playSuccessSound();
      toast({
        title: "Conversa deletada",
        description: `${result.deleted} mensagens deletadas com sucesso`,
      });

      // Remover conversa da lista
      setConversations(prev => prev.filter(c => c.contactPhone !== selectedConversation.contactPhone));
      setSelectedConversation(null);

      // Recarregar conversas
      setTimeout(() => {
        loadConversations();
      }, 500);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao deletar",
        description: error instanceof Error ? error.message : "Erro ao deletar conversa",
        variant: "destructive",
      });
    } finally {
      setIsDeletingConversation(false);
    }
  }, [selectedConversation, isDeletingConversation, playSuccessSound, playErrorSound, loadConversations]);

  // Função para fechar modal e limpar estados
  const closeNewConversationModal = useCallback(() => {
    setIsNewConversationOpen(false);
    setNewContactName("");
    setNewContactPhone("");
    setNewContactCpf("");
    setNewContactContract("");
    setNewContactTemplateId("");
    setSelectedLineId("");
  }, []);

  const handleNewConversation = useCallback(async () => {
    if (!newContactName.trim() || !newContactPhone.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome e telefone são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    if (!selectedLineId) {
      toast({
        title: "Linha obrigatória",
        description: "Selecione uma linha para enviar o template",
        variant: "destructive",
      });
      return;
    }

    if (!newContactTemplateId) {
      toast({
        title: "Template obrigatório",
        description: "Selecione um template para enviar",
        variant: "destructive",
      });
      return;
    }

    // Validar que operador tem permissão para 1x1
    if (!user?.oneToOneActive) {
      toast({
        title: "Sem permissão",
        description: "Você não tem permissão para iniciar conversas 1x1",
        variant: "destructive",
      });
      return;
    }

    try {
      // Primeiro, criar ou atualizar o contato
      try {
        await contactsService.create({
          name: newContactName.trim(),
          phone: newContactPhone.trim(),
          cpf: newContactCpf.trim() || undefined,
          contract: newContactContract.trim() || undefined,
          segment: user.segmentId,
        });
      } catch {
        // Contato pode já existir, ignorar erro
      }

      // Enviar template imediatamente
      await templatesService.send({
        templateId: parseInt(newContactTemplateId),
        phone: newContactPhone.trim(),
        contactName: newContactName.trim(),
        lineId: parseInt(selectedLineId),
      });

      playSuccessSound();
      toast({
        title: "Conversa criada",
        description: "Template enviado com sucesso",
      });
      
      await loadConversations();

      // Fechar dialog e limpar campos
      closeNewConversationModal();

      // Aguardar um pouco e selecionar a nova conversa
      setTimeout(async () => {
        await loadConversations();
        const updated = await conversationsService.getActive();
        const newConv = updated.find(c => c.contactPhone === newContactPhone.trim());
        if (newConv) {
          const grouped = {
            contactPhone: newConv.contactPhone,
            contactName: newConv.contactName,
            lastMessage: newConv.message,
            lastMessageTime: newConv.datetime,
            isFromContact: newConv.sender === 'contact',
            messages: [newConv],
          };
          setSelectedConversation(grouped);
        }
      }, 1000);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao criar conversa",
        description: error instanceof Error ? error.message : "Erro ao criar conversa",
        variant: "destructive",
      });
    }
  }, [newContactName, newContactPhone, newContactCpf, newContactContract, newContactTemplateId, selectedLineId, user, playSuccessSound, playErrorSound, loadConversations]);

  const formatTime = (datetime: string) => {
    try {
      return format(new Date(datetime), 'HH:mm');
    } catch {
      return '';
    }
  };

  const handleDownloadPDF = useCallback(() => {
    if (!selectedConversation) return;

    // Criar HTML formatado para a conversa
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Conversa - ${selectedConversation.contactName}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .header p {
      margin: 5px 0;
      color: #666;
    }
    .message {
      margin-bottom: 15px;
      padding: 10px;
      border-radius: 8px;
    }
    .message.operator {
      background-color: #e3f2fd;
      margin-left: 20%;
      text-align: right;
    }
    .message.contact {
      background-color: #f5f5f5;
      margin-right: 20%;
    }
    .message-header {
      font-weight: bold;
      margin-bottom: 5px;
      font-size: 12px;
      color: #666;
    }
    .message-content {
      margin-bottom: 5px;
    }
    .message-time {
      font-size: 11px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${selectedConversation.contactName}</h1>
    <p>Telefone: ${selectedConversation.contactPhone}</p>
    <p>Data: ${format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
  </div>
  ${selectedConversation.messages.map(msg => `
    <div class="message ${msg.sender === 'operator' ? 'operator' : 'contact'}">
      <div class="message-header">${msg.sender === 'operator' ? (msg.userName || 'Operador') : selectedConversation.contactName}</div>
      <div class="message-content">${msg.message || (msg.mediaUrl ? `[${msg.messageType}]` : '')}</div>
      <div class="message-time">${format(new Date(msg.datetime), 'dd/MM/yyyy HH:mm:ss')}</div>
    </div>
  `).join('')}
</body>
</html>
    `;

    // Criar blob e abrir em nova janela para impressão
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');
    
    if (printWindow) {
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          URL.revokeObjectURL(url);
        }, 250);
      };
    }

    toast({
      title: "Download iniciado",
      description: "Use a opção 'Salvar como PDF' na janela de impressão",
    });
  }, [selectedConversation]);

  return (
    <MainLayout>
      <div className="h-[calc(100vh-6rem)] flex flex-col md:flex-row gap-4 relative">
        {/* Mobile: Botão para abrir sidebar */}
        {!selectedConversation && !isSidebarOpen && (
          <Button
            variant="outline"
            size="icon"
            className="md:hidden fixed top-20 left-4 z-50"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        
        {/* Mobile: Overlay para fechar sidebar */}
        {isSidebarOpen && !selectedConversation && (
          <div
            className="md:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-30"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        
        {/* Conversations List */}
        <GlassCard className={cn(
          "flex flex-col transition-transform duration-300",
          "w-full md:w-80",
          "fixed md:relative inset-0 md:inset-auto z-40 md:z-auto",
          (!selectedConversation || isSidebarOpen) ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )} padding="none">
          {/* Header */}
          <div className="p-4 border-b border-border/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {/* Mobile: Botão para fechar sidebar */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden h-8 w-8"
                    onClick={() => {
                      setSelectedConversation(null);
                      setIsSidebarOpen(true);
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                <h2 className="font-semibold text-foreground">Atendimentos</h2>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                        isRealtimeConnected 
                          ? 'bg-success/10 text-success' 
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {isRealtimeConnected ? (
                          <Wifi className="h-3 w-3" />
                        ) : (
                          <WifiOff className="h-3 w-3" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isRealtimeConnected 
                        ? 'Conectado em tempo real' 
                        : 'WebSocket desconectado - Atualize a página'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.reload()}
                className="h-8 w-8 p-0"
                title="Atualizar página"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Dialog open={isNewConversationOpen} onOpenChange={setIsNewConversationOpen}>
                <DialogTrigger asChild>
                  <Button size="icon" className="h-8 w-8">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nova Conversa</DialogTitle>
                    <DialogDescription>
                      Inicie uma nova conversa com um contato
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nome *</Label>
                      <Input 
                        id="name" 
                        placeholder="Nome do contato"
                        value={newContactName}
                        onChange={(e) => setNewContactName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Telefone *</Label>
                      <Input 
                        id="phone" 
                        placeholder="+55 11 99999-9999"
                        value={newContactPhone}
                        onChange={(e) => setNewContactPhone(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF</Label>
                      <Input 
                        id="cpf" 
                        placeholder="000.000.000-00"
                        value={newContactCpf}
                        onChange={(e) => setNewContactCpf(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contract">Contrato</Label>
                      <Input
                        id="contract"
                        placeholder="Número do contrato"
                        value={newContactContract}
                        onChange={(e) => setNewContactContract(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="line">Linha * (escolha a linha do seu segmento)</Label>
                      <Select
                        value={selectedLineId}
                        onValueChange={setSelectedLineId}
                        disabled={isLoadingLines}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingLines ? "Carregando linhas..." : "Selecione uma linha"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableLines.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">
                              Nenhuma linha disponível
                            </div>
                          ) : (
                            availableLines.map((line) => (
                              <SelectItem key={line.id} value={line.id.toString()}>
                                {line.phone}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Escolha a linha que será usada para enviar a mensagem. Os templates disponíveis serão filtrados pela linha escolhida.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-template">Template * (apenas templates da linha selecionada)</Label>
                      <Select 
                        value={newContactTemplateId} 
                        onValueChange={setNewContactTemplateId}
                        disabled={isLoadingTemplates}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingTemplates ? "Carregando templates..." : "Selecione um template"} />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">
                              Nenhum template disponível
                            </div>
                          ) : (
                            templates.map((template) => (
                              <SelectItem key={template.id} value={template.id.toString()}>
                                {template.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        A primeira mensagem deve SEMPRE ser um template. Ele será enviado automaticamente ao criar a conversa.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={closeNewConversationModal}>
                      Cancelar
                    </Button>
                    <Button onClick={handleNewConversation} disabled={!newContactTemplateId || !selectedLineId}>
                      Criar e Enviar Template
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            
            {/* Botões de Filtro */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={conversationFilter === 'todas' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setConversationFilter('todas')}
              >
                Todas
              </Button>
              <Button
                variant={conversationFilter === 'stand-by' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setConversationFilter('stand-by')}
              >
                Stand By
              </Button>
              <Button
                variant={conversationFilter === 'atendimento' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setConversationFilter('atendimento')}
              >
                Atendimento
              </Button>
              <Button
                variant={conversationFilter === 'finalizadas' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setConversationFilter('finalizadas')}
              >
                Finalizadas
              </Button>
            </div>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <MessageCircle className="h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma conversa ativa</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {conversations.map((conv) => (
                  <button
                    key={conv.contactPhone}
                    onClick={() => {
                      setSelectedConversation(conv);
                      setIsSidebarOpen(false); // Fechar sidebar em mobile quando conversa é selecionada
                    }}
                    className={cn(
                      "w-full p-3 rounded-xl text-left transition-colors",
                      "hover:bg-primary/5",
                      selectedConversation?.contactPhone === conv.contactPhone && "bg-primary/10"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-primary-foreground">
                          {conv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm text-foreground truncate">
                            {conv.contactName}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(conv.lastMessageTime)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {conv.isFromContact ? (
                            <ArrowLeft className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ArrowRight className="h-3 w-3 text-primary" />
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessage}
                          </p>
                        </div>
                      </div>
                      {conv.unread && (
                        <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </GlassCard>

        {/* Chat Area */}
        <GlassCard className={cn(
          "flex-1 flex flex-col",
          selectedConversation ? "flex" : "hidden md:flex"
        )} padding="none">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-border/50 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  {/* Mobile: Botão voltar */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden h-8 w-8"
                    onClick={() => {
                      setSelectedConversation(null);
                      setIsSidebarOpen(true);
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center">
                    <span className="text-sm font-medium text-primary-foreground">
                      {selectedConversation.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{selectedConversation.contactName}</p>
                    <p className="text-xs text-muted-foreground">{selectedConversation.contactPhone}</p>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openEditContact}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar Contato</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {user?.role === 'admin' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownloadPDF}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Baixar conversa em PDF</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {(user?.role === 'admin' || user?.role === 'digital') && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={handleDeleteConversation}
                            disabled={isDeletingConversation}
                          >
                            {isDeletingConversation ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Deletar conversa</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="flex gap-2">
                  {(user?.role === 'supervisor' || user?.role === 'admin') && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setIsTransferDialogOpen(true)}
                    >
                      Transferir
                    </Button>
                  )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Tabular
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <div className="p-2 border-b" onClick={(e) => e.stopPropagation()}>
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Pesquisar tabulação..."
                          value={tabulationSearch}
                          onChange={(e) => setTabulationSearch(e.target.value)}
                          className="pl-8 h-8"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {tabulations
                        .filter((tab) => 
                          tab.name.toLowerCase().includes(tabulationSearch.toLowerCase())
                        )
                        .map((tab) => (
                          <DropdownMenuItem key={tab.id} onClick={() => handleTabulate(tab.id)}>
                            {tab.name}
                          </DropdownMenuItem>
                        ))}
                      {tabulations.filter((tab) => 
                        tab.name.toLowerCase().includes(tabulationSearch.toLowerCase())
                      ).length === 0 && (
                        <DropdownMenuItem disabled>
                          {tabulationSearch ? 'Nenhuma tabulação encontrada' : 'Nenhuma tabulação disponível'}
                        </DropdownMenuItem>
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              </div>

              {/* Modal de Edição de Contato */}
              <Dialog open={isEditContactOpen} onOpenChange={setIsEditContactOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Editar Contato</DialogTitle>
                    <DialogDescription>
                      Edite as informações do contato
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-name">Nome</Label>
                      <Input
                        id="edit-name"
                        placeholder="Nome do contato"
                        value={editContactName}
                        onChange={(e) => setEditContactName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-cpf">CPF</Label>
                      <Input
                        id="edit-cpf"
                        placeholder="000.000.000-00"
                        value={editContactCpf}
                        onChange={(e) => setEditContactCpf(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-contract">Contrato</Label>
                      <Input
                        id="edit-contract"
                        placeholder="Número do contrato"
                        value={editContactContract}
                        onChange={(e) => setEditContactContract(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <Label className="text-base font-medium">Marcar como CPC</Label>
                        <p className="text-sm text-muted-foreground">
                          Contato foi contatado com sucesso
                        </p>
                      </div>
                      <Switch
                        checked={editContactIsCPC}
                        onCheckedChange={setEditContactIsCPC}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsEditContactOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveContact} disabled={isSavingContact}>
                      {isSavingContact ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Salvar
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Dialog de Transferência */}
              <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Transferir Conversa</DialogTitle>
                    <DialogDescription>
                      Selecione o operador para quem deseja transferir esta conversa
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="operator">Operador *</Label>
                      <Select 
                        value={selectedOperatorId} 
                        onValueChange={setSelectedOperatorId}
                        disabled={isLoadingOperators}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingOperators ? "Carregando operadores..." : "Selecione um operador"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableOperators.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">
                              Nenhum operador online disponível
                            </div>
                          ) : (
                            availableOperators.map((operator) => (
                              <SelectItem key={operator.id} value={operator.id.toString()}>
                                {operator.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Apenas operadores online do mesmo segmento são exibidos
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => {
                      setIsTransferDialogOpen(false);
                      setSelectedOperatorId("");
                    }}>
                      Cancelar
                    </Button>
                    <Button onClick={handleTransfer} disabled={!selectedOperatorId}>
                      Transferir
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {selectedConversation.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-2",
                        msg.sender === 'contact' ? "justify-start" : "justify-end"
                      )}
                    >
                      {msg.sender === 'contact' && (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium">
                            {selectedConversation.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[70%] rounded-2xl px-4 py-2",
                          msg.sender === 'contact'
                            ? "bg-card border border-border"
                            : "bg-primary text-primary-foreground"
                        )}
                      >
                        {/* Renderizar mídia baseado no messageType */}
                        {msg.messageType === 'image' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <img
                              src={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `${API_BASE_URL}${msg.mediaUrl}`}
                              alt="Imagem"
                              className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                              style={{ maxHeight: '300px' }}
                              onClick={() => window.open(msg.mediaUrl!.startsWith('http') ? msg.mediaUrl! : `${API_BASE_URL}${msg.mediaUrl}`, '_blank')}
                            />
                            {msg.message && !msg.message.includes('recebida') && (
                              <p className="text-sm mt-2">{msg.message}</p>
                            )}
                          </div>
                        ) : msg.messageType === 'audio' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <audio
                              controls
                              className="max-w-full"
                              src={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `${API_BASE_URL}${msg.mediaUrl}`}
                            >
                              Seu navegador não suporta áudio.
                            </audio>
                          </div>
                        ) : msg.messageType === 'video' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <video
                              controls
                              className="max-w-full rounded-lg"
                              style={{ maxHeight: '300px' }}
                              src={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `${API_BASE_URL}${msg.mediaUrl}`}
                            >
                              Seu navegador não suporta vídeo.
                            </video>
                            {msg.message && !msg.message.includes('recebido') && (
                              <p className="text-sm mt-2">{msg.message}</p>
                            )}
                          </div>
                        ) : msg.messageType === 'document' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <a
                              href={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `${API_BASE_URL}${msg.mediaUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm underline hover:no-underline"
                            >
                              <FileText className="h-4 w-4" />
                              {msg.message || 'Documento'}
                            </a>
                          </div>
                        ) : (
                          <div>
                            {msg.messageType === 'template' && (
                              <div className={cn(
                                "text-xs font-medium mb-1 flex items-center gap-1",
                                msg.sender === 'contact' ? "text-muted-foreground" : "text-primary-foreground/80"
                              )}>
                                <FileText className="h-3 w-3" />
                                Template
                              </div>
                            )}
                            <p className="text-sm">{msg.message}</p>
                          </div>
                        )}
                        <p className={cn(
                          "text-xs mt-1",
                          msg.sender === 'contact' ? "text-muted-foreground" : "text-primary-foreground/70"
                        )}>
                          {formatTime(msg.datetime)}
                        </p>
                      </div>
                      {msg.sender === 'operator' && (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-primary-foreground">OP</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t border-border/50 flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                {selectedConversation && canSendFreeMessage(selectedConversation) ? (
                  // Mensagem livre (quando já há mensagens do operador ou é inbound)
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder="Digite sua mensagem..."
                        disabled={isSending || !selectedConversation}
                        rows={3}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        className="flex-1 resize-none"
                      />
                      <Button 
                        size="icon" 
                        onClick={handleSendMessage} 
                        disabled={isSending || !messageText.trim()}
                        className="self-end"
                      >
                        {isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Você também pode enviar um template usando o seletor abaixo
                    </p>
                    <Select 
                      value={selectedTemplateId} 
                      onValueChange={setSelectedTemplateId}
                      disabled={isSending || isLoadingTemplates}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={isLoadingTemplates ? "Carregando templates..." : "Ou selecione um template (opcional)"} />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground">
                            Nenhum template disponível
                          </div>
                        ) : (
                          templates.map((template) => (
                            <SelectItem key={template.id} value={template.id.toString()}>
                              {template.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {selectedTemplateId && (
                      <Button 
                        onClick={handleSendTemplate} 
                        disabled={isSending || !selectedTemplateId || isLoadingTemplates}
                        className="w-full"
                        variant="outline"
                      >
                        {isSending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Enviando...
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-2" />
                            Enviar Template
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                ) : (
                  // Template obrigatório (primeira mensagem outbound)
                  <div className="space-y-2">
                    <Select 
                      value={selectedTemplateId} 
                      onValueChange={setSelectedTemplateId}
                      disabled={isSending || isLoadingTemplates || !selectedConversation}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={isLoadingTemplates ? "Carregando templates..." : "Selecione um template (obrigatório)"} />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground">
                            Nenhum template disponível
                          </div>
                        ) : (
                          templates.map((template) => (
                            <SelectItem key={template.id} value={template.id.toString()}>
                              {template.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <Button 
                      onClick={handleSendTemplate} 
                      disabled={isSending || !selectedTemplateId || isLoadingTemplates}
                      className="w-full"
                    >
                      {isSending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Enviar Template
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      A primeira mensagem deve ser um template aprovado. Após isso, você poderá enviar mensagens livres.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageCircle className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">Selecione uma conversa</p>
              <p className="text-sm">Escolha uma conversa para começar o atendimento</p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Dialog de Notificação de Linha Banida */}
      <Dialog open={!!lineBannedNotification} onOpenChange={(open) => !open && setLineBannedNotification(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Linha Banida
            </DialogTitle>
            <DialogDescription>
              {lineBannedNotification?.message}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-1">Linha banida:</p>
              <p className="text-sm text-muted-foreground">{lineBannedNotification?.bannedLinePhone}</p>
              {lineBannedNotification?.newLinePhone && (
                <>
                  <p className="text-sm font-medium mt-3 mb-1">Nova linha atribuída:</p>
                  <p className="text-sm text-success">{lineBannedNotification.newLinePhone}</p>
                </>
              )}
            </div>

            {lineBannedNotification && lineBannedNotification.contactsToRecall.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-3">
                  Contatos para rechamar ({lineBannedNotification.contactsToRecall.length}):
                </p>
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-2">
                    {lineBannedNotification.contactsToRecall.map((contact) => (
                      <div
                        key={contact.phone}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">{contact.name}</p>
                          <p className="text-xs text-muted-foreground">{contact.phone}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (isRecallingContact === contact.phone) return;
                            
                            setIsRecallingContact(contact.phone);
                            try {
                              await conversationsService.recallContact(contact.phone);
                              toast({
                                title: "✅ Contato rechamado",
                                description: `Conversa reiniciada com ${contact.name}`,
                              });
                              
                              // Recarregar conversas
                              await loadConversations();
                              
                              // Selecionar a conversa recém-criada
                              await loadConversations();
                              // Usar setTimeout para garantir que o estado foi atualizado
                              setTimeout(() => {
                                setConversations(prev => {
                                  const found = prev.find(c => c.contactPhone === contact.phone);
                                  if (found) {
                                    setSelectedConversation(found);
                                  }
                                  return prev;
                                });
                              }, 100);
                              
                              // Remover da lista de contatos para rechamar
                              setLineBannedNotification(prev => {
                                if (!prev) return null;
                                const updated = prev.contactsToRecall.filter(c => c.phone !== contact.phone);
                                if (updated.length === 0) {
                                  return null; // Fechar dialog se não houver mais contatos
                                }
                                return { ...prev, contactsToRecall: updated };
                              });
                            } catch (error) {
                              toast({
                                title: "Erro ao rechamar contato",
                                description: error instanceof Error ? error.message : "Erro desconhecido",
                                variant: "destructive",
                              });
                            } finally {
                              setIsRecallingContact(null);
                            }
                          }}
                          disabled={isRecallingContact === contact.phone || !!isRecallingContact}
                        >
                          {isRecallingContact === contact.phone ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Rechamando...
                            </>
                          ) : (
                            <>
                              <Phone className="mr-2 h-4 w-4" />
                              Rechamar
                            </>
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {lineBannedNotification && lineBannedNotification.contactsToRecall.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum contato para rechamar.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLineBannedNotification(null)}
            >
              Fechar
            </Button>
            {lineBannedNotification && lineBannedNotification.contactsToRecall.length > 0 && (
              <Button
                onClick={async () => {
                  // Rechamar todos os contatos
                  if (!lineBannedNotification) return;
                  
                  const contacts = [...lineBannedNotification.contactsToRecall];
                  for (const contact of contacts) {
                    try {
                      setIsRecallingContact(contact.phone);
                      await conversationsService.recallContact(contact.phone);
                      await new Promise(resolve => setTimeout(resolve, 500)); // Pequeno delay entre chamadas
                    } catch (error) {
                      console.error(`Erro ao rechamar ${contact.phone}:`, error);
                    } finally {
                      setIsRecallingContact(null);
                    }
                  }
                  
                  toast({
                    title: "✅ Contatos rechamados",
                    description: `${contacts.length} contato(s) rechamado(s) com sucesso`,
                  });
                  
                  await loadConversations();
                  setLineBannedNotification(null);
                }}
                disabled={!!isRecallingContact}
              >
                {isRecallingContact ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rechamando todos...
                  </>
                ) : (
                  <>
                    <Phone className="mr-2 h-4 w-4" />
                    Rechamar Todos
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
