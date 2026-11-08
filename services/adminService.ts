import { supabase } from '../lib/supabase';
import { Reservation, Task, AppSettings } from '../types';

// Lista de veículos padrão usados na aplicação


export interface DashboardStats {
  totalTrips: number;
  totalKm: number;
  totalUsers: number;
  activeTripsNow: number;
}

export interface UserRanking {
  userId: string;
  userName: string;
  totalKm: number;
  tripCount: number;
  averageKmPerTrip: number;
}

export interface ActivityItem {
  id: string;
  type: 'trip_start' | 'trip_end' | 'login';
  userName: string;
  vehicle?: string;
  timestamp: string;
  details?: string;
}

export interface VehicleStatus {
  id: string;
  vehicleName: string;
  plate: string;
  type: 'Passeio' | 'Utilitario';
  status: 'Livre' | 'Ocupado' | 'Bloqueado';
  isBlocked: boolean;
  blockReason: string | null;
  blockedAt: string | null;
  blockedBy: string | null;
}

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  userId?: string;
  vehicle?: string;
  status?: 'active' | 'completed';
}

export interface CreateTaskDTO {
  title: string;
  description?: string;
  deadline?: string;
  priority: 'baixa' | 'media' | 'alta';
  assignedTo: string;
  createdBy: string;
  destinationName?: string;
  destinationAddress?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
}

// Estado local para bloqueio de veículos (fallback quando tabela não existe)
let localVehicleBlocks: Record<string, { blocked: boolean; reason: string | null; blockedAt: string | null; blockedBy: string | null }> = {};

// Tentar carregar do localStorage
// DEPRECATED: Usando tabela vehicles agora, mas mantido para fallback temporário de bloqueios antigos se necessário
try {
  const saved = localStorage.getItem('nbapark_vehicle_blocks');
  if (saved) {
    localVehicleBlocks = JSON.parse(saved);
  }
} catch (e) {
  console.debug('Could not load vehicle blocks from localStorage');
}

const saveLocalVehicleBlocks = () => {
  try {
    localStorage.setItem('nbapark_vehicle_blocks', JSON.stringify(localVehicleBlocks));
  } catch (e) {
    console.debug('Could not save vehicle blocks to localStorage');
  }
};

export const adminService = {
  async getDashboardStats(): Promise<DashboardStats> {
    try {
      // Get all reservations
      const { data: reservations, error: resError } = await supabase
        .from('reservations')
        .select('*');

      if (resError) {
        console.error('Error fetching reservations:', resError);
      }

      // Get all users
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id');

      if (usersError) {
        console.error('Error fetching users:', usersError);
      }

      // Calculate stats
      const totalTrips = reservations?.length || 0;
      const totalKm = reservations?.reduce((sum, r) => {
        if (r.end_odometer && r.start_odometer) {
          return sum + (r.end_odometer - r.start_odometer);
        }
        return sum;
      }, 0) || 0;
      const totalUsers = users?.length || 0;
      const activeTripsNow = reservations?.filter(r => r.status === 'active').length || 0;

      return {
        totalTrips,
        totalKm,
        totalUsers,
        activeTripsNow
      };
    } catch (error) {
      console.error('Error in getDashboardStats:', error);
      return {
        totalTrips: 0,
        totalKm: 0,
        totalUsers: 0,
        activeTripsNow: 0
      };
    }
  },

  async getUserRankings(): Promise<UserRanking[]> {
    try {
      // Buscar TODAS as reservas (não apenas completed) para ter dados
      const { data: reservations, error } = await supabase
        .from('reservations')
        .select('*');

      if (error) {
        console.error('Error fetching reservations for ranking:', error);
        return [];
      }

      if (!reservations || reservations.length === 0) {
        return [];
      }

      // Group by user (usando employee_name como chave)
      const userStats: Record<string, { totalKm: number; tripCount: number; userName: string }> = {};

      reservations.forEach(r => {
        const userName = r.employee_name || 'Desconhecido';
        const kmDiff = (r.end_odometer || 0) - (r.start_odometer || 0);

        if (!userStats[userName]) {
          userStats[userName] = {
            totalKm: 0,
            tripCount: 0,
            userName: userName
          };
        }

        // Só contar KM se a viagem foi finalizada
        if (r.status === 'completed' && kmDiff > 0) {
          userStats[userName].totalKm += kmDiff;
        }
        userStats[userName].tripCount += 1;
      });

      // Convert to array and sort
      const rankings: UserRanking[] = Object.entries(userStats).map(([userName, stats]) => ({
        userId: userName,
        userName: stats.userName,
        totalKm: stats.totalKm,
        tripCount: stats.tripCount,
        averageKmPerTrip: stats.tripCount > 0 ? Math.round(stats.totalKm / stats.tripCount) : 0
      }));

      // Sort by total KM descending, then by trip count
      rankings.sort((a, b) => {
        if (b.totalKm !== a.totalKm) return b.totalKm - a.totalKm;
        return b.tripCount - a.tripCount;
      });

      return rankings.slice(0, 10); // Top 10
    } catch (error) {
      console.error('Error in getUserRankings:', error);
      return [];
    }
  },

  async getActivityFeed(): Promise<ActivityItem[]> {
    try {
      const activities: ActivityItem[] = [];

      // Get recent reservations
      const { data: reservations, error: resError } = await supabase
        .from('reservations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (resError) {
        console.error('Error fetching reservations:', resError);
      }

      // Add reservation activities
      reservations?.forEach(r => {
        activities.push({
          id: r.id + '-start',
          type: 'trip_start',
          userName: r.employee_name || 'Usuário',
          vehicle: r.vehicle || 'Polo Volkswagen',
          timestamp: r.start_time || r.created_at,
          details: r.itinerary || 'Viagem iniciada'
        });

        if (r.end_time) {
          const kmRodados = (r.end_odometer || 0) - (r.start_odometer || 0);
          activities.push({
            id: r.id + '-end',
            type: 'trip_end',
            userName: r.employee_name || 'Usuário',
            vehicle: r.vehicle || 'Polo Volkswagen',
            timestamp: r.end_time,
            details: `${kmRodados} KM percorridos`
          });
        }
      });

      // Try to get user logs (may not exist)
      try {
        const { data: logs, error: logsError } = await supabase
          .from('user_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30);

        if (!logsError && logs) {
          logs.forEach(log => {
            if (log.action === 'LOGIN' || log.action === 'LOCATION_PERMISSION_DENIED') {
              activities.push({
                id: log.id,
                type: 'login',
                userName: log.details?.userName || 'Usuário',
                timestamp: log.created_at,
                details: log.action === 'LOCATION_PERMISSION_DENIED' 
                  ? 'Negou a permissão de localização' 
                  : (log.details?.method === 'NEW_REGISTER' ? 'Novo cadastro' : 'Login no sistema')
              });
            }
          });
        }
      } catch (e) {
        // user_logs table may not exist, ignore
      }

      // Sort by timestamp descending
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return activities.slice(0, 50);
    } catch (error) {
      console.error('Error in getActivityFeed:', error);
      return [];
    }
  },

  async getDetailedReport(filters: ReportFilters): Promise<Reservation[]> {
    try {
      let query = supabase
        .from('reservations')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.vehicle) {
        query = query.eq('vehicle', filters.vehicle);
      }

      if (filters.startDate) {
        query = query.gte('start_time', filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte('start_time', filters.endDate + 'T23:59:59');
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching report data:', error);
        return [];
      }

      return data?.map((r: any) => ({
        id: r.id,
        employeeName: r.employee_name,
        vehicle: r.vehicle || 'Polo Volkswagen',
        startOdometer: r.start_odometer,
        endOdometer: r.end_odometer,
        itinerary: r.itinerary,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status
      })) || [];
    } catch (error) {
      console.error('Error in getDetailedReport:', error);
      return [];
    }
  },

  async getVehicleStatus(): Promise<VehicleStatus[]> {
    try {
      // 1. Get all vehicles
      const { data: vehiclesData, error: vError } = await supabase
        .from('vehicles')
        .select('*')
        .order('name');

      if (vError) throw vError;

      // 2. Get active reservations to determine occupancy
      const { data: activeReservations, error: rError } = await supabase
        .from('reservations')
        .select('vehicle')
        .eq('status', 'active');

      if (rError) console.error('Error checking active reservations:', rError);

      const occupiedVehicles = new Set(activeReservations?.map(r => r.vehicle));

      return (vehiclesData || []).map((v: any) => {
        let status: 'Livre' | 'Ocupado' | 'Bloqueado' = 'Livre';

        if (v.is_blocked) {
          status = 'Bloqueado';
        } else if (occupiedVehicles.has(v.name)) {
          status = 'Ocupado';
        }

        return {
          id: v.id,
          vehicleName: v.name,
          plate: v.plate,
          type: v.type,
          status: status,
          isBlocked: v.is_blocked,
          blockReason: v.block_reason,
          blockedAt: v.blocked_at,
          blockedBy: v.blocked_by
        };
      });
    } catch (e) {
      console.error('Error fetching vehicle status:', e);
      return [];
    }
  },

  async createVehicle(vehicle: { name: string, plate: string, type: 'Passeio' | 'Utilitario' }): Promise<void> {
    const { error } = await supabase
      .from('vehicles')
      .insert([{
        name: vehicle.name,
        plate: vehicle.plate,
        type: vehicle.type
      }]);
    if (error) throw error;
  },

  async updateVehicle(id: string, updates: Partial<{ name: string, plate: string, type: 'Passeio' | 'Utilitario' }>): Promise<void> {
    const { error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
  },

  async deleteVehicle(id: string): Promise<void> {
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async blockVehicle(vehicleId: string, reason: string, blockedBy: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({
          is_blocked: true,
          block_reason: reason,
          blocked_at: new Date().toISOString(),
          blocked_by: blockedBy,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (error) throw error;
    } catch (e) {
      console.error('Error blocking vehicle:', e);
      throw e;
    }
  },

  async unblockVehicle(vehicleId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({
          is_blocked: false,
          block_reason: null,
          blocked_at: null,
          blocked_by: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (error) throw error;
    } catch (e) {
      console.error('Error unblocking vehicle:', e);
      throw e;
    }
  },

  async isVehicleBlocked(vehicleName: string): Promise<{ blocked: boolean; reason: string | null }> {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('is_blocked, block_reason')
        .eq('name', vehicleName)
        .maybeSingle(); // Use maybeSingle to avoid error if not found immediately

      if (!error && data) {
        return {
          blocked: data.is_blocked || false,
          reason: data.block_reason || null
        };
      }
      return { blocked: false, reason: null };
    } catch (e) {
      console.error('Error checking vehicle blocked status:', e);
      return { blocked: false, reason: null };
    }
  },

  async getAllTasks(): Promise<Task[]> {
    const { data, error } = await supabase
      .from('tasks')
      .select(`
        *,
        assignee:users!assigned_to(name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tasks:', error);
      return [];
    }

    return data.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      deadline: t.deadline,
      priority: t.priority,
      status: t.status,
      assignedTo: t.assigned_to,
      assigneeName: t.assignee?.name,
      createdBy: t.created_by,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      destinationName: t.destination_name,
      destinationAddress: t.destination_address,
      destinationLatitude: t.destination_latitude,
      destinationLongitude: t.destination_longitude,
    }));
  },

  async createTask(task: CreateTaskDTO): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .insert([{
        title: task.title,
        description: task.description,
        deadline: task.deadline,
        priority: task.priority,
        assigned_to: task.assignedTo,
        created_by: task.createdBy,
        destination_name: task.destinationName,
        destination_address: task.destinationAddress,
        destination_latitude: task.destinationLatitude,
        destination_longitude: task.destinationLongitude,
        status: 'pendente'
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating task:', error);
      throw error;
    }

    return {
      id: data.id,
      title: data.title,
      description: data.description,
      deadline: data.deadline,
      priority: data.priority,
      status: data.status,
      assignedTo: data.assigned_to,
      createdBy: data.created_by,
      createdAt: data.created_at,

      updatedAt: data.updated_at,
      destinationName: data.destination_name,
      destinationAddress: data.destination_address,
      destinationLatitude: data.destination_latitude,
      destinationLongitude: data.destination_longitude,
    };
  },

  async getAppSettings(): Promise<AppSettings> {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*');

      if (error) throw error;

      const settings: AppSettings = {
        companyName: 'NBAPARK Fleet Control',
        logoUrl: '/logo.png',
        aboutText: 'Sistema de controle de frota empresarial.'
      };

      data?.forEach((item: any) => {
        if (item.key === 'company_name') settings.companyName = item.value;
        if (item.key === 'logo_url') settings.logoUrl = item.value;
        if (item.key === 'about_text') settings.aboutText = item.value;
      });

      return settings;
    } catch (error) {
      console.error('Error fetching app settings:', error);
      return {
        companyName: 'NBAPARK Fleet Control',
        logoUrl: '/logo.png',
        aboutText: 'Sistema de controle de frota empresarial.'
      };
    }
  },

  async updateAppSettings(settings: AppSettings): Promise<void> {
    const updates = [
      { key: 'company_name', value: settings.companyName, updated_at: new Date() },
      { key: 'logo_url', value: settings.logoUrl, updated_at: new Date() },
      { key: 'about_text', value: settings.aboutText, updated_at: new Date() }
    ];

    const { error } = await supabase
      .from('app_settings')
      .upsert(updates);

    if (error) throw error;
  },

  async getWebhookUrl(): Promise<boolean> {
    const { data, error } = await supabase.functions.invoke('fleet-webhook', {
      body: { action: 'status' },
    });
    if (error) throw error;
    return Boolean(data?.configured);
  },

  async saveWebhookUrl(url: string): Promise<void> {
    const { error } = await supabase.functions.invoke('fleet-webhook', {
      body: { action: 'save', url },
    });
    if (error) throw error;
  }
};
