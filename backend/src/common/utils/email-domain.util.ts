/**
 * Extrai o domínio de um email
 * Exemplo: "user@example.com" -> "example.com"
 */
export function getEmailDomain(email: string): string {
  if (!email || !email.includes('@')) {
    return '';
  }
  return email.split('@')[1].toLowerCase();
}

/**
 * Verifica se dois emails são do mesmo domínio
 */
export function isSameDomain(email1: string, email2: string): boolean {
  return getEmailDomain(email1) === getEmailDomain(email2);
}
