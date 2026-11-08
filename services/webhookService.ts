// Helper para obter data ISO com fuso horário de São Paulo
const getSaoPauloISOString = () => {
  const date = new Date();
  
  // Opções para obter partes da data no fuso correto
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const formatter = new Intl.DateTimeFormat('pt-BR', options);
  const parts = formatter.formatToParts(date);
  
  const part = (type: string) => parts.find(p => p.type === type)?.value || '00';
  
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');

  // Retorna formato ISO8601 com offset fixo -03:00 (Horário Padrão de Brasília)
  // Nota: Isso não considera horário de verão automaticamente no offset numérico se mudasse, 
  // mas 'America/Sao_Paulo' no Intl garante hora correta.
  return `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`;
};

import { supabase } from '../lib/supabase';

export const sendWebhook = async (data: any) => {
  try {
    const { error } = await supabase.functions.invoke('fleet-webhook', {
      body: {
        action: 'send',
        payload: {
          timestamp: getSaoPauloISOString(),
          ...data,
        },
      },
    });
    if (error) console.error('Falha no envio do webhook:', error.message);
  } catch (error) {
    console.error("Erro ao preparar webhook:", error);
  }
};
