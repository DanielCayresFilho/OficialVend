# Plano de Implementação: Reestruturação de Linha-Operador e Mock Data

## Objetivo Principal

Reestruturar a arquitetura do sistema para remover o vínculo rígido entre linhas e operadores, permitindo que operadores usem livremente qualquer linha de seu segmento. Além disso, melhorar a exibição de templates no frontend e adicionar dados mockados aos relatórios.

---

## Mudanças Conceituais

### Antes (Sistema Atual)
- Operador é "vinculado" a uma linha específica (tabela `LineOperator`)
- Apenas 2 operadores por linha
- Templates filtrados por `lineId` e `segmentId`
- Frontend mostra "Template enviado" genérico

### Depois (Sistema Proposto)
- **Sem vínculo fixo**: Operadores usam qualquer linha do seu segmento
- **Binding correto**: Conversa ↔ Telefone ↔ Operador ↔ Segmento ↔ Linha usada
- No 1x1: Operador **escolhe** qual linha usar para enviar template
- Templates filtrados pela linha **selecionada** no modal 1x1
- Frontend mostra conteúdo real do template: `"template: Olá João, tudo bem?"`

---

## Parte 1: Reestruturação Backend

### 1.1 Schema Prisma (Mudanças Mínimas)

**Arquivo**: `backend/prisma/schema.prisma`

**Mudanças**:
- Manter tabela `LineOperator` para compatibilidade (pode ser usada futuramente para auditoria)
- Adicionar comentários esclarecendo que `user.line` é deprecated
- Manter campos `lineId` no Template (para compatibilidade, mas será ignorado na lógica)

**Status**: ✅ Schema já está adequado, apenas adicionar comentários de documentação

---

### 1.2 Templates Service - Lógica de Filtro

**Arquivo**: `backend/src/templates/templates.service.ts`

**Mudanças Necessárias**:

1. **Método `findByLineAndSegment` (linha 119-147)**:
   - ✅ **JÁ ESTÁ CORRETO**: Já filtra templates por segmento da linha + globais
   - Não precisa alterar

2. **Método `sendTemplate` (linha 329-474)**:
   - ✅ **VALIDAÇÃO DE SEGMENTO JÁ EXISTE** (linhas 349-365)
   - Garante que operador só usa linhas do próprio segmento
   - ✅ **userId JÁ É ATRIBUÍDO** (linha 441)
   - ✅ **Mensagem JÁ MOSTRA CONTEÚDO REAL** (linhas 415-442):
     ```typescript
     message: `template: ${messageText}`, // Texto substituído com variáveis
     ```

**Status**: ✅ Backend já está implementado corretamente!

---

### 1.3 Conversations Service

**Arquivo**: `backend/src/conversations/conversations.service.ts`

**Verificação**:
- ✅ `findActiveConversations` filtra por `userId` (linhas 193-246)
- ✅ `findTabulatedConversations` filtra por `userId` (linhas 248-300)
- ✅ `recallContact` usa `userId` e `userLine` (linha 415)

**Status**: ✅ Já implementado corretamente

---

### 1.4 Lines Service

**Arquivo**: `backend/src/lines/lines.service.ts` (precisa verificar)

**Mudanças Necessárias**:
- Endpoint `GET /lines/segment/:segmentId` deve retornar TODAS as linhas ativas do segmento
- Remover filtros de "linha já vinculada a 2 operadores"
- Operadores podem ver e usar qualquer linha ativa do segmento

---

## Parte 2: Reestruturação Frontend

### 2.1 Modal de Nova Conversa (1x1)

**Arquivo**: `frontend/src/pages/Atendimento.tsx`

**Localização**: Linhas 1311-1427 (Dialog de Nova Conversa)

**Mudanças**:

1. **Seleção de Linha (linha 1369-1388)**:
   - ✅ JÁ EXISTE: Operador escolhe linha manualmente
   - ✅ Templates já são carregados pela linha selecionada (useEffect linha 597-616)

2. **Melhorias de UX**:
   - Adicionar **preview do template** ao selecionar
   - Mostrar variáveis do template de forma clara
   - Simplificar labels para usuários menos técnicos

**Mockup de Interface Melhorada**:
```
┌─────────────────────────────────────────────┐
│ Nova Conversa 1x1                           │
├─────────────────────────────────────────────┤
│                                             │
│ Nome do contato: [___________]              │
│ Telefone: [___________]                     │
│                                             │
│ Escolha a linha para enviar:                │
│ [▼ Linha 1 - 5514988123456 (Segmento 1) ]  │
│                                             │
│ Escolha a mensagem inicial:                 │
│ [▼ Boas-vindas - Olá {{nome}}! ]            │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Preview:                                │ │
│ │ Olá João! Como posso te ajudar?         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│           [Cancelar] [Enviar Mensagem]      │
└─────────────────────────────────────────────┘
```

---

### 2.2 Exibição de Templates nas Conversas

**Arquivo**: `frontend/src/pages/Atendimento.tsx`

**Localização**: Renderização de mensagens (precisa localizar)

**Mudança**:
- Backend já retorna `message: "template: [conteúdo real]"`
- Frontend deve renderizar esse texto diretamente
- Adicionar ícone de template para diferenciação visual

**Antes**:
```
[ícone] Template enviado
```

**Depois**:
```
[ícone template] Olá João, tudo bem? Vi que você tem interesse...
```

---

### 2.3 Simplificação para Usuários Menos Técnicos

**Melhorias de UX**:

1. **Labels mais claros**:
   - "Template" → "Mensagem inicial"
   - "Linha" → "Número de WhatsApp para enviar"
   - "Variáveis" → "Personalize a mensagem"

2. **Validação visual**:
   - ✅ Verde quando campo está correto
   - ⚠️ Amarelo quando falta preencher
   - ❌ Vermelho quando há erro

3. **Tooltips explicativos**:
   - Hover em cada campo mostra dica
   - Exemplo: "Escolha qual número de WhatsApp será usado para iniciar a conversa"

---

## Parte 3: Mock Data nos Relatórios

### 3.1 Páginas que Precisam de Mock Data

**Arquivos a modificar**:
1. `frontend/src/pages/Envios.tsx`
2. `frontend/src/pages/Indicadores.tsx`
3. `frontend/src/pages/Tempos.tsx`
4. `frontend/src/pages/OperacionalSintetico.tsx`
5. `frontend/src/pages/KPI.tsx`
6. `frontend/src/pages/HSM.tsx`
7. `frontend/src/pages/StatusDeLinha.tsx`

### 3.2 Estrutura de Mock Data

**Criar arquivo**: `frontend/src/data/mockReports.ts`

```typescript
// Dados mockados para apresentação ao cliente
export const mockEnvios = {
  total: 45230,
  sucesso: 42100,
  falha: 3130,
  taxa_sucesso: 93.1,
  por_dia: [
    { data: '2026-01-01', enviados: 1523, sucesso: 1420, falha: 103 },
    { data: '2026-01-02', enviados: 2105, sucesso: 1980, falha: 125 },
    // ... mais dias
  ],
  por_linha: [
    { linha: '5514988123456', enviados: 8234, sucesso: 7650, falha: 584 },
    { linha: '5514988654321', enviados: 6892, sucesso: 6420, falha: 472 },
    // ... mais linhas
  ]
};

export const mockIndicadores = {
  tempo_medio_resposta: '2m 34s',
  taxa_conversao: 68.4,
  satisfacao_cliente: 4.7,
  conversas_ativas: 234,
  conversas_finalizadas: 1829,
  // ...
};

// ... mais mocks para outros relatórios
```

### 3.3 Feature Toggle para Mock

**Adicionar ao `.env`**:
```env
VITE_USE_MOCK_DATA=true
```

**Lógica**:
```typescript
const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

const data = useMockData ? mockEnvios : await reportsService.getEnvios();
```

---

## Ordem de Implementação

### Fase 1: Backend (2-3 horas)
1. ✅ Verificar/documentar schema Prisma
2. ✅ Revisar templates.service.ts (já está correto)
3. ⚠️ Verificar/ajustar lines.service.ts
4. ✅ Confirmar conversations.service.ts

### Fase 2: Frontend - Templates (2-3 horas)
1. Melhorar UX do modal 1x1
2. Adicionar preview de template
3. Simplificar labels e adicionar tooltips
4. Melhorar renderização de templates nas conversas

### Fase 3: Mock Data (1-2 horas)
1. Criar arquivo `mockReports.ts` com dados realistas
2. Implementar feature toggle
3. Atualizar todas as 7 páginas de relatórios
4. Adicionar gráficos e visualizações

---

## Pontos de Atenção

### ⚠️ Compatibilidade
- Manter campos legacy (`user.line`, `lineOperators`) para compatibilidade
- Não quebrar fluxos existentes (campanhas, webhooks)

### ⚠️ Validações Críticas
- Operador só pode usar linhas do **próprio segmento**
- Linha deve estar **ativa** (`lineStatus = 'active'`)
- Operador deve ter `oneToOneActive = true`

### ⚠️ Performance
- Templates: usar cache no frontend (já carrega por linha)
- Linhas: carregar apenas linhas ativas do segmento

---

## Resultado Esperado

### Para o Operador:
1. Abre modal 1x1
2. Escolhe **qualquer linha do seu segmento** (dropdown simples)
3. Vê **apenas templates dessa linha** (filtro automático)
4. Vê **preview da mensagem** antes de enviar
5. Clica "Enviar Mensagem" (texto claro)

### No Histórico:
- Mostra conteúdo real: `"template: Olá João, vi que você..."`
- Ícone diferenciado para templates
- Informações claras de qual linha foi usada

### Nos Relatórios:
- Dados mockados realistas para apresentação
- Gráficos funcionais
- Possibilidade de desabilitar mock via `.env`

---

## Testes Necessários

1. **Operador com segmento 1** deve ver apenas linhas do segmento 1
2. **Operador com segmento 2** deve ver apenas linhas do segmento 2
3. Selecionar linha X deve mostrar apenas templates de segmento X + globais
4. Template enviado deve aparecer com conteúdo real na conversa
5. Múltiplos operadores podem usar a mesma linha simultaneamente
6. Mock data deve aparecer quando flag estiver ativada

---

## Arquivos que Serão Modificados

### Backend:
- `backend/prisma/schema.prisma` (documentação)
- `backend/src/lines/lines.service.ts` (remover limite de 2 operadores)
- `backend/src/lines/lines.controller.ts` (se necessário)

### Frontend:
- `frontend/src/pages/Atendimento.tsx` (melhorias UX)
- `frontend/src/data/mockReports.ts` (NOVO - mock data)
- `frontend/src/pages/Envios.tsx` (integrar mock)
- `frontend/src/pages/Indicadores.tsx` (integrar mock)
- `frontend/src/pages/Tempos.tsx` (integrar mock)
- `frontend/src/pages/OperacionalSintetico.tsx` (integrar mock)
- `frontend/src/pages/KPI.tsx` (integrar mock)
- `frontend/src/pages/HSM.tsx` (integrar mock)
- `frontend/src/pages/StatusDeLinha.tsx` (integrar mock)

### Configuração:
- `frontend/.env.example` (adicionar VITE_USE_MOCK_DATA)

---

## Estimativa Total

**Tempo**: 5-8 horas de desenvolvimento
**Complexidade**: Média (maior parte já está implementada)
**Risco**: Baixo (mudanças são incrementais e compatíveis)
