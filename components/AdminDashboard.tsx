import React, { useState, useEffect, useCallback } from 'react';
import { adminService, DashboardStats, UserRanking, ActivityItem, VehicleStatus, ReportFilters } from '../services/adminService';
import { supabase } from '../lib/supabase';
import { Reservation, Task, AppSettings } from '../types';
import { MapaFrota } from './MapaFrota';
import { TaskMetrics } from './TaskMetrics';
import { pdfReportService } from '../services/pdfReportService';
import { PlatformSettings } from './PlatformSettings';

interface AdminDashboardProps {
  onExit: () => void;
  currentUser: { id: string; name: string } | null;
  appSettings: AppSettings | null;
  onSettingsChange: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onExit, currentUser, appSettings: globalAppSettings, onSettingsChange }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [rankings, setRankings] = useState<UserRanking[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleStatus[]>([]);
  const [reportData, setReportData] = useState<Reservation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<{ id: string, name: string }[]>([]);

  // Local state for editing form
  const [editingSettings, setEditingSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (globalAppSettings) {
      setEditingSettings(globalAppSettings);
    }
  }, [globalAppSettings]);

  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSection, setActiveSection] = useState<'overview' | 'ranking' | 'activity' | 'vehicles' | 'reports' | 'mapa' | 'tasks' | 'settings'>('overview');
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);

  // Report filters
  const [filters, setFilters] = useState<ReportFilters>({});

  // Vehicle block modal
  const [blockingVehicle, setBlockingVehicle] = useState<VehicleStatus | null>(null);
  const [blockReason, setBlockReason] = useState('');

  // Vehicle Management Modal
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleStatus | null>(null);
  const [vehicleForm, setVehicleForm] = useState({ name: '', plate: '', type: 'Passeio' as 'Passeio' | 'Utilitario' });

  // Task Modal
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [taskFilters, setTaskFilters] = useState({
    status: 'todas',
    priority: 'todas',
    userId: 'todos',
    dateRange: 'all' // all, today, week, month
  });
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookConfigured, setWebhookConfigured] = useState(false);

  // Check if desktop
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [statsData, rankingsData, activitiesData, vehiclesData, tasksData] = await Promise.all([
        adminService.getDashboardStats(),
        adminService.getUserRankings(),
        adminService.getActivityFeed(),
        adminService.getVehicleStatus(),
        adminService.getAllTasks()
      ]);

      setStats(statsData);
      setRankings(rankingsData);
      setActivities(activitiesData);
      setVehicles(vehiclesData);
      setTasks(tasksData);

      // Load webhook url
      adminService.getWebhookUrl().then(setWebhookConfigured).catch(error => {
        console.error('Error loading webhook status:', error);
        setWebhookConfigured(false);
      });

      // Fetch users for task assignment (just reusing ranking data for now or fetching specifically)
      const { data: userData } = await supabase.from('users').select('id, name');
      if (userData) setUsers(userData);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadData, 30000);

    // Realtime subscription for tasks
    const taskSubscription = supabase
      .channel('admin-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        adminService.getAllTasks().then(setTasks);
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      taskSubscription.unsubscribe();
    };
  }, [loadData]);

  // Load report data
  const loadReportData = async () => {
    try {
      const data = await adminService.getDetailedReport(filters);
      setReportData(data);
    } catch (error) {
      console.error('Error loading report:', error);
    }
  };

  useEffect(() => {
    if (activeSection === 'reports') {
      loadReportData();
    }
  }, [activeSection, filters]);

  // Export PDF Detalhado
  const exportPDF = () => {
    if (reportData.length === 0) return alert('Sem dados para exportar.');
    pdfReportService.generateDetailedReport(
      reportData,
      filters,
      {
        companyName: globalAppSettings?.companyName || 'NBAPARK Fleet Control',
        generatedBy: currentUser?.name || 'Administrador'
      }
    );
  };

  // Export CSV
  const exportCSV = () => {
    if (reportData.length === 0) return alert('Sem dados para exportar.');

    const headers = ['ID', 'Motorista', 'Veículo', 'Data Saída', 'Hora Saída', 'Data Volta', 'Hora Volta', 'KM Inicial', 'KM Final', 'KM Total', 'Itinerário', 'Status'];

    const csvContent = [
      headers.join(','),
      ...reportData.map(r => {
        const start = new Date(r.startTime);
        const end = r.endTime ? new Date(r.endTime) : null;
        const kmDiff = (r.endOdometer || 0) - r.startOdometer;

        return [
          r.id,
          `"${r.employeeName}"`,
          `"${r.vehicle}"`,
          start.toLocaleDateString('pt-BR'),
          start.toLocaleTimeString('pt-BR'),
          end ? end.toLocaleDateString('pt-BR') : '-',
          end ? end.toLocaleTimeString('pt-BR') : '-',
          r.startOdometer,
          r.endOdometer || '-',
          r.endOdometer ? kmDiff : '-',
          `"${r.itinerary || ''}"`,
          r.status
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_frota_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Block/Unblock vehicle
  const handleBlockVehicle = async () => {
    if (!blockingVehicle || !blockReason.trim()) return;

    try {
      await adminService.blockVehicle(blockingVehicle.id, blockReason, 'Admin');
      setBlockingVehicle(null);
      setBlockReason('');
      loadData();
    } catch (error) {
      console.error('Error blocking vehicle:', error);
      alert('Erro ao bloquear veículo.');
    }
  };

  const handleUnblockVehicle = async (vehicleId: string) => {
    try {
      await adminService.unblockVehicle(vehicleId);
      loadData();
    } catch (error) {
      console.error('Error unblocking vehicle:', error);
      alert('Erro ao desbloquear veículo.');
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (taskFilters.status !== 'todas' && task.status !== taskFilters.status) return false;
    if (taskFilters.priority !== 'todas' && task.priority !== taskFilters.priority) return false;
    if (taskFilters.userId !== 'todos' && task.assignedTo !== taskFilters.userId) return false;

    if (taskFilters.dateRange === 'today') {
      const today = new Date().toISOString().split('T')[0];
      return task.deadline?.startsWith(today);
    }
    // Add more date ranges if needed
    return true;
  });

  const handleCreateTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      await adminService.createTask({
        title: formData.get('title') as string,
        description: formData.get('description') as string,
        deadline: formData.get('deadline') as string,
        priority: formData.get('priority') as any,
        assignedTo: formData.get('assignedTo') as string,
        createdBy: currentUser?.id || 'unknown',
        destinationName: formData.get('destinationName') as string,
        destinationAddress: formData.get('destinationAddress') as string,
      });

      setShowTaskModal(false);
      loadData();
      alert('Tarefa criada com sucesso!');
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Erro ao criar tarefa.');
    }
  };

  const handleSaveWebhook = async () => {
    try {
      await adminService.saveWebhookUrl(webhookUrl);
      setWebhookConfigured(Boolean(webhookUrl.trim()));
      setWebhookUrl('');
      alert(webhookUrl.trim() ? 'Webhook salvo com segurança.' : 'Webhook removido.');
    } catch (error) {
      console.error('Error saving webhook:', error);
      alert('Erro ao salvar webhook.');
    }
  };

  const handleClearWebhook = async () => {
    try {
      await adminService.saveWebhookUrl('');
      setWebhookConfigured(false);
      setWebhookUrl('');
      alert('Webhook removido.');
    } catch (error) {
      console.error('Error removing webhook:', error);
      alert('Erro ao remover webhook.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSettings) return;

    try {
      await adminService.updateAppSettings(editingSettings);
      if (onSettingsChange) onSettingsChange();
      alert('Configurações salvas com sucesso!');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Erro ao salvar configurações.');
    }
  };

  // Vehicle Management Functions
  const handleOpenVehicleModal = (vehicle?: VehicleStatus) => {
    if (vehicle) {
      setEditingVehicle(vehicle);
      setVehicleForm({ name: vehicle.vehicleName, plate: vehicle.plate, type: vehicle.type });
    } else {
      setEditingVehicle(null);
      setVehicleForm({ name: '', plate: '', type: 'Passeio' });
    }
    setShowVehicleModal(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingVehicle) {
        await adminService.updateVehicle(editingVehicle.id, vehicleForm);
        alert('Veículo atualizado com sucesso!');
      } else {
        await adminService.createVehicle(vehicleForm);
        alert('Veículo cadastrado com sucesso!');
      }
      setShowVehicleModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving vehicle:', error);
      alert('Erro ao salvar veículo.');
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este veículo?')) return;
    try {
      await adminService.deleteVehicle(id);
      loadData();
    } catch (error) {
      console.error('Error deleting vehicle:', error);
      alert('Erro ao excluir veículo.');
    }
  };

  // Mobile warning
  if (!isDesktop) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-8">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-10 text-center max-w-md border border-white/20">
          <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="fas fa-desktop text-yellow-400 text-4xl"></i>
          </div>
          <h2 className="text-2xl font-black text-white uppercase tracking-wider mb-4">Desktop Necessário</h2>
          <p className="text-gray-300 mb-6">Esta dashboard está disponível apenas em dispositivos desktop para melhor visualização dos dados.</p>
          <button
            onClick={onExit}
            className="bg-white/20 hover:bg-white/30 text-white font-bold px-6 py-3 rounded-xl transition-all"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Voltar ao App
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-circle-notch animate-spin text-6xl text-blue-400 mb-6"></i>
          <p className="text-white font-bold uppercase tracking-widest">Carregando Dashboard...</p>
        </div>
      </div>
    );
  }

  // Fullscreen Map View
  if (showFullscreenMap) {
    return <MapaFrota onExit={() => setShowFullscreenMap(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">

      {/* Header */}
      <header className="bg-black/30 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <img src={globalAppSettings?.logoUrl || "/logo.png"} alt="Logo" className="h-14 w-auto drop-shadow-lg" />
            <div>
              <h1 className="text-1 font-black uppercase tracking-tighter">Admin Dashboard</h1>
              <p className="text-xs font-bold text-red-400 uppercase tracking-[0.3em]">{globalAppSettings?.companyName || 'NBAPARK'}</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-2xl font-black tabular-nums">
                {currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
              <p className="text-xs text-gray-400 font-bold uppercase">
                {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>

            <div className="flex items-center gap-2 bg-green-500/20 px-3 py-2 rounded-xl border border-green-500/30">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              <span className="text-xs font-bold text-green-400 uppercase">Live</span>
            </div>

            <button
              onClick={onExit}
              className="bg-white/10 hover:bg-white/20 p-3 rounded-xl transition-all"
              title="Voltar ao App"
            >
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Navigation Tabs */}
        <nav className="flex gap-2 mb-8 bg-black/20 p-2 rounded-2xl backdrop-blur-sm">
          {[
            { id: 'overview', icon: 'fa-chart-pie', label: 'Visão Geral' },
            { id: 'mapa', icon: 'fa-map-marked-alt', label: 'Mapa' },
            { id: 'ranking', icon: 'fa-trophy', label: 'Ranking' },
            { id: 'activity', icon: 'fa-stream', label: 'Atividades' },
            { id: 'vehicles', icon: 'fa-car', label: 'Veículos' },

            { id: 'tasks', icon: 'fa-tasks', label: 'Tarefas' },
            { id: 'reports', icon: 'fa-file-export', label: 'Relatórios' },
            { id: 'settings', icon: 'fa-cog', label: 'Configurações' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'mapa') {
                  setShowFullscreenMap(true);
                } else {
                  setActiveSection(tab.id as any);
                }
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold uppercase text-sm tracking-wider transition-all ${activeSection === tab.id
                ? 'bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
                }`}
            >
              <i className={`fas ${tab.icon}`}></i>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Overview Section */}
        {activeSection === 'overview' && (
          <div className="space-y-8 animate-fadeIn">
            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-6">
              <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 backdrop-blur-xl rounded-3xl p-6 border border-blue-500/20 group hover:border-blue-400/40 transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-blue-500/30 p-3 rounded-xl">
                    <i className="fas fa-road text-blue-300 text-2xl"></i>
                  </div>
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Total</span>
                </div>
                <p className="text-4xl font-black mb-1">{stats?.totalTrips.toLocaleString('pt-BR')}</p>
                <p className="text-sm text-gray-400 font-bold uppercase">Viagens Realizadas</p>
              </div>

              <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 backdrop-blur-xl rounded-3xl p-6 border border-green-500/20 group hover:border-green-400/40 transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-green-500/30 p-3 rounded-xl">
                    <i className="fas fa-tachometer-alt text-green-300 text-2xl"></i>
                  </div>
                  <span className="text-xs font-bold text-green-400 uppercase tracking-wider">KM</span>
                </div>
                <p className="text-4xl font-black mb-1">{stats?.totalKm.toLocaleString('pt-BR')}</p>
                <p className="text-sm text-gray-400 font-bold uppercase">Quilômetros Rodados</p>
              </div>

              <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 backdrop-blur-xl rounded-3xl p-6 border border-purple-500/20 group hover:border-purple-400/40 transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-purple-500/30 p-3 rounded-xl">
                    <i className="fas fa-users text-purple-300 text-2xl"></i>
                  </div>
                  <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Cadastros</span>
                </div>
                <p className="text-4xl font-black mb-1">{stats?.totalUsers}</p>
                <p className="text-sm text-gray-400 font-bold uppercase">Usuários Ativos</p>
              </div>

              <div className="bg-gradient-to-br from-orange-500/20 to-red-600/10 backdrop-blur-xl rounded-3xl p-6 border border-orange-500/20 group hover:border-orange-400/40 transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-orange-500/30 p-3 rounded-xl">
                    <i className="fas fa-fire text-orange-300 text-2xl animate-pulse"></i>
                  </div>
                  <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">Agora</span>
                </div>
                <p className="text-4xl font-black mb-1">{stats?.activeTripsNow}</p>
                <p className="text-sm text-gray-400 font-bold uppercase">Viagens Ativas</p>
              </div>
            </div>

            {/* Alert Section for Permission Denial */}
            {activities.some(a => a.type === 'login' && a.id.includes('permission-denied') || a.details?.includes('negou a permissão')) && (
              <div className="bg-red-500/10 border-l-8 border-red-500 p-6 rounded-3xl shadow-lg relative overflow-hidden animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-500/20 rounded-2xl flex items-center justify-center">
                    <i className="fas fa-location-arrow text-2xl text-red-400"></i>
                  </div>
                  <div>
                    <h3 className="text-red-400 font-black uppercase italic tracking-tighter text-lg">Alertas de Localização</h3>
                    <p className="text-red-300 text-xs font-bold uppercase tracking-wider">Usuários negaram permissão de GPS recentemente</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {activities
                    .filter(a => a.type === 'login' && a.details?.includes('negou a permissão'))
                    .slice(0, 3)
                    .map(alert => (
                      <div key={alert.id} className="bg-white/5 p-3 rounded-xl border border-red-500/20 flex justify-between items-center">
                        <div>
                          <p className="text-sm font-black text-white uppercase">{alert.userName}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-bold">{new Date(alert.timestamp).toLocaleString()}</p>
                        </div>
                        <span className="text-[10px] bg-red-500 text-white px-2 py-1 rounded font-black uppercase tracking-widest">Negado</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Quick View: Top 3 + Recent Activity */}
            <div className="grid grid-cols-2 gap-6">
              {/* Top 3 */}
              <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-6 border border-white/10">
                <h3 className="text-lg font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                  <i className="fas fa-trophy text-yellow-400"></i>
                  Top 3 Motoristas
                </h3>
                <div className="space-y-3">
                  {rankings.slice(0, 3).map((user, index) => (
                    <div key={user.userId} className="flex items-center gap-4 bg-white/5 p-4 rounded-xl">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg ${index === 0 ? 'bg-yellow-500 text-black' :
                        index === 1 ? 'bg-gray-400 text-black' :
                          'bg-orange-700 text-white'
                        }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-black uppercase">{user.userName}</p>
                        <p className="text-xs text-gray-400">{user.tripCount} viagens</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-black text-blue-400">{user.totalKm.toLocaleString('pt-BR')}</p>
                        <p className="text-xs text-gray-500">KM</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-6 border border-white/10">
                <h3 className="text-lg font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                  <i className="fas fa-stream text-blue-400"></i>
                  Atividade Recente
                </h3>
                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                  {activities.slice(0, 8).map(activity => (
                    <div key={activity.id} className="flex items-center gap-3 bg-white/5 p-3 rounded-xl text-sm">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activity.type === 'trip_start' ? 'bg-green-500/30 text-green-400' :
                        activity.type === 'trip_end' ? 'bg-red-500/30 text-red-400' :
                          'bg-blue-500/30 text-blue-400'
                        }`}>
                        <i className={`fas ${activity.type === 'trip_start' ? 'fa-play' :
                          activity.type === 'trip_end' ? 'fa-stop' :
                            'fa-sign-in-alt'
                          } text-xs`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{activity.userName}</p>
                        <p className="text-xs text-gray-500 truncate">{activity.details}</p>
                      </div>
                      <p className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(activity.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ranking Section */}
        {activeSection === 'ranking' && (
          <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-8 border border-white/10 animate-fadeIn">
            <h3 className="text-xl font-black uppercase tracking-wider mb-6 flex items-center gap-3">
              <i className="fas fa-trophy text-yellow-400"></i>
              Ranking de Motoristas
              <span className="text-sm font-normal text-gray-400 ml-auto">Top 10 por KM rodados</span>
            </h3>

            <div className="overflow-hidden rounded-2xl">
              <table className="w-full">
                <thead className="bg-white/10">
                  <tr>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase tracking-wider text-gray-400">#</th>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase tracking-wider text-gray-400">Motorista</th>
                    <th className="text-right py-4 px-6 text-xs font-black uppercase tracking-wider text-gray-400">Total KM</th>
                    <th className="text-right py-4 px-6 text-xs font-black uppercase tracking-wider text-gray-400">Viagens</th>
                    <th className="text-right py-4 px-6 text-xs font-black uppercase tracking-wider text-gray-400">Média</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((user, index) => (
                    <tr key={user.userId} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-4 px-6">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${index === 0 ? 'bg-yellow-500 text-black' :
                          index === 1 ? 'bg-gray-400 text-black' :
                            index === 2 ? 'bg-orange-700 text-white' :
                              'bg-white/10 text-gray-400'
                          }`}>
                          {index + 1}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <p className="font-black uppercase text-lg">{user.userName}</p>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <p className="text-2xl font-black text-blue-400">{user.totalKm.toLocaleString('pt-BR')}</p>
                        <p className="text-xs text-gray-500">quilômetros</p>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <p className="text-xl font-bold">{user.tripCount}</p>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <p className="text-lg font-bold text-gray-400">{user.averageKmPerTrip} km</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Activity Section */}
        {activeSection === 'activity' && (
          <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-8 border border-white/10 animate-fadeIn">
            <h3 className="text-xl font-black uppercase tracking-wider mb-6 flex items-center gap-3">
              <i className="fas fa-stream text-blue-400"></i>
              Feed de Atividades
              <div className="flex items-center gap-2 bg-green-500/20 px-3 py-1 rounded-lg border border-green-500/30 ml-auto">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                <span className="text-xs font-bold text-green-400 uppercase">Tempo Real</span>
              </div>
            </h3>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {activities.map(activity => (
                <div key={activity.id} className="flex items-center gap-4 bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-all">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${activity.type === 'trip_start' ? 'bg-green-500/30 text-green-400' :
                    activity.type === 'trip_end' ? 'bg-red-500/30 text-red-400' :
                      'bg-blue-500/30 text-blue-400'
                    }`}>
                    <i className={`fas ${activity.type === 'trip_start' ? 'fa-play' :
                      activity.type === 'trip_end' ? 'fa-flag-checkered' :
                        'fa-sign-in-alt'
                      } text-xl`}></i>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-black uppercase">{activity.userName}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${activity.type === 'trip_start' ? 'bg-green-500/30 text-green-400' :
                        activity.type === 'trip_end' ? 'bg-red-500/30 text-red-400' :
                          'bg-blue-500/30 text-blue-400'
                        }`}>
                        {activity.type === 'trip_start' ? 'Iniciou Viagem' :
                          activity.type === 'trip_end' ? 'Finalizou Viagem' : 'Login'}
                      </span>
                    </div>
                    {activity.vehicle && (
                      <p className="text-sm text-gray-400"><i className="fas fa-car mr-1"></i>{activity.vehicle}</p>
                    )}
                    {activity.details && (
                      <p className="text-sm text-gray-500 mt-1">{activity.details}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {new Date(activity.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(activity.timestamp).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vehicles Section */}
        {activeSection === 'vehicles' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-8 border border-white/10">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-3">
                  <i className="fas fa-car text-blue-400"></i>
                  Controle de Veículos
                </h3>
                <button
                  onClick={() => handleOpenVehicleModal()}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-2"
                >
                  <i className="fas fa-plus"></i>
                  Adicionar Veículo
                </button>
              </div>

              <div className="grid gap-4">
                {vehicles.map(vehicle => (
                  <div key={vehicle.id} className={`p-6 rounded-2xl border transition-all ${vehicle.isBlocked
                    ? 'bg-red-500/10 border-red-500/30'
                    : vehicle.status === 'Ocupado'
                      ? 'bg-orange-500/10 border-orange-500/30'
                      : 'bg-green-500/10 border-green-500/30'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${vehicle.isBlocked ? 'bg-red-500/30' : vehicle.status === 'Ocupado' ? 'bg-orange-500/30' : 'bg-green-500/30'
                          }`}>
                          <i className={`fas ${vehicle.isBlocked ? 'fa-lock' : 'fa-car'} text-3xl ${vehicle.isBlocked ? 'text-red-400' : vehicle.status === 'Ocupado' ? 'text-orange-400' : 'text-green-400'
                            }`}></i>
                        </div>
                        <div>
                          <h4 className="text-xl font-black uppercase">{vehicle.vehicleName}</h4>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-300">
                            <span className="font-bold"><i className="fas fa-closed-captioning mr-1"></i>{vehicle.plate}</span>
                            <span className="w-1 h-1 bg-gray-500 rounded-full"></span>
                            <span>{vehicle.type}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${vehicle.isBlocked
                              ? 'bg-red-500/30 text-red-400'
                              : vehicle.status === 'Ocupado'
                                ? 'bg-orange-500/30 text-orange-400'
                                : 'bg-green-500/30 text-green-400'
                              }`}>
                              {vehicle.isBlocked ? 'Bloqueado' : vehicle.status}
                            </span>
                            {vehicle.isBlocked && vehicle.blockReason && (
                              <span className="text-sm text-gray-400">
                                <i className="fas fa-info-circle mr-1"></i>
                                {vehicle.blockReason}
                              </span>
                            )}
                          </div>
                          {vehicle.isBlocked && vehicle.blockedAt && (
                            <p className="text-xs text-gray-500 mt-2">
                              Bloqueado em: {new Date(vehicle.blockedAt).toLocaleString('pt-BR')}
                              {vehicle.blockedBy && ` por ${vehicle.blockedBy}`}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenVehicleModal(vehicle)}
                          className="bg-white/10 hover:bg-white/20 text-white p-3 rounded-xl transition-all"
                          title="Editar"
                        >
                          <i className="fas fa-edit"></i>
                        </button>

                        {vehicle.isBlocked ? (
                          <button
                            onClick={() => handleUnblockVehicle(vehicle.id)}
                            className="bg-green-500 hover:bg-green-600 text-white font-bold px-4 py-3 rounded-xl transition-all flex items-center gap-2"
                          >
                            <i className="fas fa-unlock"></i>
                            <span className="hidden md:inline">Desbloquear</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => setBlockingVehicle(vehicle)}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-3 rounded-xl transition-all flex items-center gap-2"
                          >
                            <i className="fas fa-lock"></i>
                            <span className="hidden md:inline">Bloquear</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteVehicle(vehicle.id)}
                          className="bg-red-500/20 hover:bg-red-500/40 text-red-400 p-3 rounded-xl transition-all"
                          title="Excluir"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {vehicles.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <i className="fas fa-car text-4xl mb-4 opacity-30"></i>
                    <p>Nenhum veículo cadastrado.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Vehicle Modal */}
        {showVehicleModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-[#1a1f2e] border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-scaleIn">
              <h3 className="text-xl font-black uppercase tracking-wider mb-6">
                {editingVehicle ? 'Editar Veículo' : 'Novo Veículo'}
              </h3>

              <form onSubmit={handleSaveVehicle} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Nome do Veículo</label>
                  <input
                    type="text"
                    required
                    value={vehicleForm.name}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none"
                    placeholder="Ex: Polo Volkswagen"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Placa</label>
                  <input
                    type="text"
                    required
                    value={vehicleForm.plate}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none"
                    placeholder="ABC-1234"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Tipo</label>
                  <select
                    value={vehicleForm.type}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, type: e.target.value as any })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none"
                  >
                    <option value="Passeio" className="bg-gray-800">Passeio</option>
                    <option value="Utilitario" className="bg-gray-800">Utilitário</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowVehicleModal(false)}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all"
                  >
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Reports Section */}
        {activeSection === 'reports' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Filters */}
            <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-6 border border-white/10">
              <h3 className="text-lg font-black uppercase tracking-wider mb-4">
                <i className="fas fa-filter mr-2 text-blue-400"></i>
                Filtros
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Data Início</label>
                  <input
                    type="date"
                    value={filters.startDate || ''}
                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Data Fim</label>
                  <input
                    type="date"
                    value={filters.endDate || ''}
                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Veículo</label>
                  <select
                    value={filters.vehicle || ''}
                    onChange={(e) => setFilters({ ...filters, vehicle: e.target.value || undefined })}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all"
                  >
                    <option value="" className="bg-gray-800 text-white">Todos os Veículos</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.vehicleName} className="bg-gray-800 text-white">
                        {v.vehicleName}
                      </option>
                    ))}
                    {!vehicles.some(v => v.vehicleName === 'Polo Volkswagen') && (
                      <option value="Polo Volkswagen" className="bg-gray-800 text-white">Polo Volkswagen</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Status</label>
                  <select
                    value={filters.status || ''}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value as any || undefined })}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all"
                  >
                    <option value="" className="bg-gray-800 text-white">Todos os Status</option>
                    <option value="completed" className="bg-gray-800 text-white">Finalizadas</option>
                    <option value="active" className="bg-gray-800 text-white">Ativas</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={exportPDF}
                    title="Baixar relatório executivo em PDF com sumário e dados detalhados"
                    className="w-full bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-500 hover:to-rose-500 shadow-lg shadow-red-500/20 text-white font-bold px-4 py-3 rounded-xl transition-all flex items-center justify-center gap-2 group cursor-pointer"
                  >
                    <i className="fas fa-file-pdf text-lg group-hover:scale-110 transition-transform"></i>
                    Exportar PDF
                  </button>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={exportCSV}
                    title="Baixar dados brutos em formato de planilha CSV"
                    className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-gray-300 hover:text-white font-bold px-4 py-3 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <i className="fas fa-file-csv text-lg text-emerald-400"></i>
                    Exportar CSV
                  </button>
                </div>
              </div>
            </div>

            {/* Report Data */}
            <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-6 border border-white/10">
              <h3 className="text-lg font-black uppercase tracking-wider mb-4 flex items-center justify-between">
                <span>
                  <i className="fas fa-file-alt mr-2 text-blue-400"></i>
                  Dados do Relatório
                </span>
                <span className="text-sm font-normal text-gray-400">{reportData.length} registros</span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/10">
                    <tr>
                      <th className="text-left py-3 px-4 text-xs font-black uppercase text-gray-400">Motorista</th>
                      <th className="text-left py-3 px-4 text-xs font-black uppercase text-gray-400">Veículo</th>
                      <th className="text-left py-3 px-4 text-xs font-black uppercase text-gray-400">Data/Hora</th>
                      <th className="text-right py-3 px-4 text-xs font-black uppercase text-gray-400">KM Inicial</th>
                      <th className="text-right py-3 px-4 text-xs font-black uppercase text-gray-400">KM Final</th>
                      <th className="text-right py-3 px-4 text-xs font-black uppercase text-gray-400">Total</th>
                      <th className="text-center py-3 px-4 text-xs font-black uppercase text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.slice(0, 20).map(trip => (
                      <tr key={trip.id} className="border-t border-white/5 hover:bg-white/5">
                        <td className="py-3 px-4 font-bold">{trip.employeeName}</td>
                        <td className="py-3 px-4 text-gray-400">{trip.vehicle}</td>
                        <td className="py-3 px-4 text-gray-400">
                          {new Date(trip.startTime).toLocaleDateString('pt-BR')} {new Date(trip.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-4 text-right">{trip.startOdometer}</td>
                        <td className="py-3 px-4 text-right">{trip.endOdometer || '-'}</td>
                        <td className="py-3 px-4 text-right font-bold text-blue-400">
                          {trip.endOdometer ? (trip.endOdometer - trip.startOdometer) : '-'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-xs font-bold px-2 py-1 rounded uppercase ${trip.status === 'completed' ? 'bg-green-500/30 text-green-400' : 'bg-blue-500/30 text-blue-400'
                            }`}>
                            {trip.status === 'completed' ? 'Finalizada' : 'Ativa'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {reportData.length > 20 && (
                  <p className="text-center text-gray-500 text-sm py-4">
                    Exibindo 20 de {reportData.length} registros. Exporte o relatório em PDF detalhado ou CSV para ver todos.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tasks Section */}
      {activeSection === 'tasks' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="bg-black/30 backdrop-blur-xl rounded-3xl p-8 border border-white/10">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-3">
                <i className="fas fa-tasks text-blue-400"></i>
                Gerenciamento de Tarefas
              </h3>
            </div>

            {/* Task Analytics & Charts */}
            <TaskMetrics tasks={tasks} />

            {/* Task Filters */}
            <div className="bg-white/5 p-4 rounded-xl mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Status</label>
                <select
                  value={taskFilters.status}
                  onChange={e => setTaskFilters({ ...taskFilters, status: e.target.value })}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                >
                  <option value="todas">Todos</option>
                  <option value="pendente">Pendente</option>
                  <option value="em_progresso">Em Progresso</option>
                  <option value="concluida">Concluída</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Prioridade</label>
                <select
                  value={taskFilters.priority}
                  onChange={e => setTaskFilters({ ...taskFilters, priority: e.target.value })}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                >
                  <option value="todas">Todas</option>
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Responsável</label>
                <select
                  value={taskFilters.userId}
                  onChange={e => setTaskFilters({ ...taskFilters, userId: e.target.value })}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                >
                  <option value="todos">Todos</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={() => setActiveSection('settings')}
                  className="bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-2 rounded-lg transition-all text-sm flex-1"
                >
                  <i className="fas fa-cog mr-2"></i>
                  Webhook
                </button>
                <button
                  onClick={() => setShowTaskModal(true)}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded-lg transition-all text-sm flex-1"
                >
                  <i className="fas fa-plus mr-2"></i>
                  Nova
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white/5">
              <table className="w-full">
                <thead className="bg-white/10">
                  <tr>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase text-gray-400">Título</th>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase text-gray-400">Responsável</th>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase text-gray-400">Prioridade</th>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase text-gray-400">Status</th>
                    <th className="text-left py-4 px-6 text-xs font-black uppercase text-gray-400">Duração</th>
                    <th className="text-right py-4 px-6 text-xs font-black uppercase text-gray-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(task => {
                    const duration = task.startedAt && task.completedAt
                      ? ((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000 / 60).toFixed(0) + ' min'
                      : '-';

                    return (
                      <tr key={task.id} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-4 px-6 font-bold">{task.title}</td>
                        <td className="py-4 px-6 text-gray-400">{task.assigneeName || 'N/A'}</td>
                        <td className="py-4 px-6">
                          <span className={`text-xs font-bold px-2 py-1 rounded uppercase ${task.priority === 'alta' ? 'bg-red-500/30 text-red-400' :
                            task.priority === 'media' ? 'bg-yellow-500/30 text-yellow-400' :
                              'bg-blue-500/30 text-blue-400'
                            }`}>
                            {task.priority}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`text-xs font-bold px-2 py-1 rounded uppercase ${task.status === 'concluida' ? 'bg-green-500/30 text-green-400' :
                            task.status === 'em_progresso' ? 'bg-blue-500/30 text-blue-400' :
                              'bg-gray-500/30 text-gray-400'
                            }`}>
                            {task.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-300 font-mono">
                          {duration}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => setViewingTask(task)}
                            className="text-blue-400 hover:text-blue-300 transition-colors mr-3"
                            title="Ver Detalhes"
                          >
                            <i className="fas fa-eye"></i>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredTasks.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500">
                        Nenhuma tarefa encontrada com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {/* Admin Task Details Modal */}
          {viewingTask && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={() => setViewingTask(null)}>
              <div className="bg-gray-900 rounded-3xl w-full max-w-lg shadow-2xl border border-white/20 overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-xl font-black text-white uppercase italic tracking-tighter leading-tight">
                        {viewingTask.title}
                      </h2>
                      <p className="text-gray-400 text-xs font-bold mt-1">
                        Responsável: <span className="text-white">{viewingTask.assigneeName || 'N/A'}</span>
                      </p>
                    </div>
                    <button onClick={() => setViewingTask(null)} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-gray-400 transition-colors active:scale-95">
                      <i className="fas fa-times"></i>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <p className="text-[10px] font-bold text-gray-500 uppercase">Status</p>
                        <div className="font-bold text-blue-400">{viewingTask.status.replace('_', ' ')}</div>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <p className="text-[10px] font-bold text-gray-500 uppercase">Prioridade</p>
                        <div className={`font-bold ${viewingTask.priority === 'alta' ? 'text-red-400' : viewingTask.priority === 'media' ? 'text-yellow-400' : 'text-green-400'}`}>
                          {viewingTask.priority}
                        </div>
                      </div>
                    </div>

                    {/* Time Tracking */}
                    <div className="bg-black/40 p-4 rounded-xl border border-white/10">
                      <h4 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2">
                        <i className="fas fa-clock text-blue-500"></i> Rastreador de Tempo
                      </h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Iniciado em:</span>
                          <span className="text-white font-mono">{viewingTask.startedAt ? new Date(viewingTask.startedAt).toLocaleString() : '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Concluído em:</span>
                          <span className="text-white font-mono">{viewingTask.completedAt ? new Date(viewingTask.completedAt).toLocaleString() : '-'}</span>
                        </div>
                        <div className="border-t border-white/10 pt-2 flex justify-between font-bold">
                          <span className="text-gray-400">Duração Total:</span>
                          <span className="text-green-400 font-mono text-lg">
                            {viewingTask.startedAt && viewingTask.completedAt
                              ? ((new Date(viewingTask.completedAt).getTime() - new Date(viewingTask.startedAt).getTime()) / 1000 / 60).toFixed(0) + ' min'
                              : '-'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Destination */}
                    {(viewingTask.destinationName || viewingTask.destinationAddress) && (
                      <div className="bg-blue-500/10 p-5 rounded-xl border border-blue-500/20 relative overflow-hidden">
                        <div className="absolute right-0 top-0 w-24 h-24 bg-blue-500/5 rounded-bl-full pointer-events-none"></div>
                        <h4 className="text-xs font-bold text-blue-400 uppercase mb-2 flex items-center gap-2">
                          <i className="fas fa-location-dot"></i> Destino
                        </h4>
                        <div className="relative z-10">
                          <p className="font-bold text-white text-lg">{viewingTask.destinationName}</p>
                          <p className="text-sm text-gray-400 mb-4">{viewingTask.destinationAddress}</p>

                          {(viewingTask.destinationLatitude || viewingTask.destinationAddress) && (
                            <a href={viewingTask.destinationLatitude
                              ? `https://www.google.com/maps/search/?api=1&query=${viewingTask.destinationLatitude},${viewingTask.destinationLongitude}`
                              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(viewingTask.destinationAddress || '')}`}
                              target="_blank" rel="noreferrer"
                              className="w-full inline-flex justify-center items-center gap-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 px-4 py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                            >
                              <i className="fas fa-external-link-alt"></i> Abrir no Maps
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    <div className="bg-white/5 p-4 rounded-xl">
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Descrição</h4>
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{viewingTask.description || 'Sem descrição'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings Section */}
      {
        activeSection === 'settings' && editingSettings && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-black uppercase tracking-wide">Central de Configurações</h2>
              <p className="text-sm text-gray-400 mt-1">Ajustes da frota e acesso aos serviços conectados.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="bg-black/30 backdrop-blur-xl rounded-3xl p-7 border border-white/10">
                <h3 className="text-lg font-black uppercase tracking-wider mb-6 flex items-center gap-3">
                  <i className="fas fa-sliders-h text-blue-400"></i> Aplicação
                </h3>
                <form onSubmit={handleSaveSettings} className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Nome da Empresa</label>
                    <input type="text" value={editingSettings.companyName} onChange={(e) => setEditingSettings({ ...editingSettings, companyName: e.target.value })} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all" placeholder="Ex: ET Frota" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">URL da Logomarca</label>
                    <input type="text" value={editingSettings.logoUrl} onChange={(e) => setEditingSettings({ ...editingSettings, logoUrl: e.target.value })} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all" placeholder="/logo.png ou https://..." />
                    <p className="text-xs text-gray-500 mt-2">Use um caminho da aplicação ou uma imagem HTTPS.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Sobre a Aplicação</label>
                    <textarea value={editingSettings.aboutText} onChange={(e) => setEditingSettings({ ...editingSettings, aboutText: e.target.value })} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-blue-500 outline-none transition-all h-28 resize-none" placeholder="Texto exibido na tela Sobre..." />
                  </div>
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl transition-all shadow-lg">
                    <i className="fas fa-save mr-2"></i>Salvar alterações
                  </button>
                </form>
              </section>

              <section className="bg-black/30 backdrop-blur-xl rounded-3xl p-7 border border-white/10">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h3 className="text-lg font-black uppercase tracking-wider flex items-center gap-3">
                    <i className="fas fa-plug text-emerald-400"></i> Webhook de eventos
                  </h3>
                  <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full ${webhookConfigured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-gray-400'}`}>
                    {webhookConfigured ? 'Configurado' : 'Desativado'}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mb-5">Receba eventos de viagens e tarefas em um endpoint HTTPS. A URL é guardada no servidor e não é enviada aos motoristas.</p>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">URL do webhook</label>
                <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder={webhookConfigured ? 'URL salva; informe outra para substituir' : 'https://...'} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500 mb-4" />
                <div className="flex flex-wrap gap-3">
                  <button onClick={handleSaveWebhook} disabled={!webhookUrl.trim()} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold px-5 py-3 rounded-xl transition-all">
                    <i className="fas fa-save mr-2"></i>{webhookConfigured ? 'Trocar URL' : 'Salvar URL'}
                  </button>
                  {webhookConfigured && <button type="button" onClick={handleClearWebhook} className="bg-red-500/15 hover:bg-red-500/25 text-red-200 font-bold px-5 py-3 rounded-xl transition-all">Remover webhook</button>}
                </div>
                <p className="text-xs text-gray-500 mt-4">Por segurança, o endpoint precisa usar HTTPS e não pode apontar para endereços locais.</p>
              </section>
            </div>

            <section className="bg-black/30 backdrop-blur-xl rounded-3xl p-7 border border-white/10">
              <h3 className="text-lg font-black uppercase tracking-wider mb-2 flex items-center gap-3">
                <i className="fas fa-server text-amber-300"></i> Serviços conectados
              </h3>
              <p className="text-sm text-gray-400 mb-5">Banco, login e infraestrutura são administrados nos serviços abaixo. Esses atalhos mantêm os segredos fora do navegador da frota.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <a href="https://supabase.com/dashboard/project/owvbxpugkybolyojukqo" target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition-colors">
                  <div className="flex items-center gap-3 mb-2"><i className="fas fa-database text-emerald-300"></i><strong>Supabase</strong><i className="fas fa-external-link-alt ml-auto text-xs text-gray-500"></i></div>
                  <p className="text-xs text-gray-400">Banco de dados, usuários, políticas, autenticação e e-mails.</p>
                </a>
                <a href="https://coolify.emersontorres.com.br/" target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition-colors">
                  <div className="flex items-center gap-3 mb-2"><i className="fas fa-cloud text-blue-300"></i><strong>Coolify</strong><i className="fas fa-external-link-alt ml-auto text-xs text-gray-500"></i></div>
                  <p className="text-xs text-gray-400">Implantação, domínio, variáveis do app, saúde e reinicialização.</p>
                </a>
                <a href="https://github.com/Apemerson/Fleet-control/actions/workflows/build-android-apk.yml" target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition-colors">
                  <div className="flex items-center gap-3 mb-2"><i className="fab fa-github text-white"></i><strong>GitHub Actions</strong><i className="fas fa-external-link-alt ml-auto text-xs text-gray-500"></i></div>
                  <p className="text-xs text-gray-400">Compilação e publicação do aplicativo Android.</p>
                </a>
              </div>
              <div className="mt-5 rounded-xl border border-blue-400/20 bg-blue-400/5 p-4 text-sm text-blue-100/80">
                <i className="fas fa-shield-alt mr-2"></i>
                O painel usa funções de servidor autenticadas para operações de infraestrutura. Os tokens são digitados pelo administrador e ficam apenas na memória da tela durante a sessão.
              </div>
            </section>

            <PlatformSettings />
          </div>
        )
      }




      {/* Task Creation Modal */}
      {
        showTaskModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-3xl p-8 max-w-lg w-full border border-white/20 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black uppercase">Nova Tarefa</h3>
                <button
                  onClick={() => setShowTaskModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <form onSubmit={handleCreateTask} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Título</label>
                  <input required name="title" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500" />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Descrição</label>
                  <textarea name="description" rows={3} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-medium outline-none focus:border-blue-500" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Responsável</label>
                    <select required name="assignedTo" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500 [&>option]:text-black">
                      <option value="">Selecione...</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 mb-2 uppercase">Prioridade</label>
                    <select required name="priority" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500 [&>option]:text-black">
                      <option value="baixa">Baixa</option>
                      <option value="media">Média</option>
                      <option value="alta">Alta</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Prazo</label>
                  <input type="datetime-local" name="deadline" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Destino (Nome)</label>
                    <input name="destinationName" placeholder="Ex: Aeroporto" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Endereço</label>
                    <input name="destinationAddress" placeholder="Rua X, 123" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-blue-500" />
                  </div>
                </div>

                <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-xl uppercase tracking-wider mt-4">
                  Criar Tarefa
                </button>
              </form>
            </div>
          </div>
        )
      }

      {/* Block Vehicle Modal */}
      {
        blockingVehicle && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-3xl p-8 max-w-md w-full mx-4 border border-white/20">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 bg-red-500/30 rounded-2xl flex items-center justify-center">
                  <i className="fas fa-lock text-red-400 text-2xl"></i>
                </div>
                <div>
                  <h3 className="text-xl font-black uppercase">Bloquear Veículo</h3>
                  <p className="text-gray-400">{blockingVehicle.vehicleName}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Motivo do Bloqueio</label>
                <select
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-red-500 outline-none transition-all mb-3"
                >
                  <option value="" className="bg-gray-800 text-white">Selecione um motivo...</option>
                  <option value="Manutenção preventiva" className="bg-gray-800 text-white">Manutenção preventiva</option>
                  <option value="Manutenção corretiva" className="bg-gray-800 text-white">Manutenção corretiva</option>
                  <option value="Abastecimento" className="bg-gray-800 text-white">Abastecimento</option>
                  <option value="Reservado para evento" className="bg-gray-800 text-white">Reservado para evento</option>
                  <option value="Documentação pendente" className="bg-gray-800 text-white">Documentação pendente</option>
                  <option value="Sinistro/Acidente" className="bg-gray-800 text-white">Sinistro/Acidente</option>
                  <option value="Outro" className="bg-gray-800 text-white">Outro</option>
                </select>
                {blockReason === 'Outro' && (
                  <input
                    type="text"
                    placeholder="Especifique o motivo..."
                    onChange={(e) => setBlockReason(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-bold focus:border-red-500 outline-none transition-all"
                  />
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setBlockingVehicle(null); setBlockReason(''); }}
                  className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleBlockVehicle}
                  disabled={!blockReason.trim()}
                  className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <i className="fas fa-lock"></i>
                  Confirmar Bloqueio
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};
