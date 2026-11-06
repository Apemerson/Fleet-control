import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/Layout';
import { Reservation, AppState, AppSettings, Vehicle } from './types';
import { analyzeItinerary, generateWeeklySummary } from './services/tipsService';
import { sendWebhook } from './services/webhookService';
import { UserLogin } from './components/UserLogin';
import { SchedulePage } from './components/SchedulePage';
import { GlobalHistory } from './components/GlobalHistory';
import { AdminDashboard } from './components/AdminDashboard';
import { TodoList } from './components/TodoList';
import { userService, User } from './services/userService';
import { adminService } from './services/adminService';
import { supabase } from './lib/supabase';
import { startTracking, stopTracking, requestGeolocationPermission, isTrackingActive } from './services/trackingService';

// DEPRECATED: Dynamic list fetched from API
// const VEHICLES = [
//   { id: 'polo-vw', name: 'Polo Volkswagen', icon: 'fa-car-side' }
// ];

interface NotificationState {
  show: boolean;
  message: string;
  type: 'success' | 'error' | 'warning';
}

import { SplashScreen } from './components/SplashScreen';
import { LocationHelpModal } from './components/LocationHelpModal';
// notificationService removed

// ... (imports existentes)

const App: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<AppState>('dashboard');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  
  // App state logic removed

  // ... (outros estados)

  // Mobile warning ...

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Estados de Dados e Erros da IA
  const [dashboardSummary, setDashboardSummary] = useState<string>('');
  const [fleetAnalysisError, setFleetAnalysisError] = useState<string | null>(null);

  // Estados de UI
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [notification, setNotification] = useState<NotificationState>({ show: false, message: '', type: 'success' });
  
  // Estado para controlar os inputs de KM final
  const [endKmValues, setEndKmValues] = useState<Record<string, string>>({});
  // Estado para controlar qual viagem está em processo de confirmação
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Estado para viagens ativas GLOBAIS (de todos os usuários)
  const [globalActiveTrips, setGlobalActiveTrips] = useState<Reservation[]>([]);
  // Estado para rastreamento GPS
  const [trackingStatus, setTrackingStatus] = useState<'idle' | 'active' | 'error'>('idle');
  // Estado para verificar se o veículo está bloqueado
  const [vehicleBlocked, setVehicleBlocked] = useState<string | null>(null);
  const [pendingTasksCount, setPendingTasksCount] = useState(0);
  const [occupiedVehicleInfo, setOccupiedVehicleInfo] = useState<{user: string, vehicle: string, otherAvailable?: string} | null>(null);

  const [geoPermission, setGeoPermission] = useState<string>('prompt');
  const [showLocationHelp, setShowLocationHelp] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [availableVehicles, setAvailableVehicles] = useState<Vehicle[]>([]);
  
  const fetchAppSettings = useCallback(() => {
    adminService.getAppSettings()
      .then(setAppSettings)
      .catch(err => console.error("Erro ao carregar configurações:", err));
      
    // Fetch vehicles
    adminService.getVehicleStatus()
      .then(vehicles => {
        const list: Vehicle[] = vehicles.map(v => ({
            id: v.id,
            name: v.vehicleName,
            icon: v.type === 'Utilitario' ? 'fa-truck-pickup' : 'fa-car-side',
            status: v.status as 'Livre' | 'Ocupado' | 'Bloqueado',
            isBlocked: v.isBlocked
          }));
        setAvailableVehicles(list);
      })
      .catch(err => console.error("Erro ao carregar veículos:", err));
  }, []);

  // Carregar configurações globais e Realtime
  useEffect(() => {
    fetchAppSettings();

    const settingsSubscription = supabase
      .channel('public:app_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
        console.log('Realtime settings update:', payload);
        fetchAppSettings();
      })
      .subscribe();

    const vehiclesSubscription = supabase
      .channel('public:vehicles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, (payload) => {
        console.log('Realtime vehicles update:', payload);
        fetchAppSettings();
      })
      .subscribe();

    return () => {
      settingsSubscription.unsubscribe();
      vehiclesSubscription.unsubscribe();
    };
  }, [fetchAppSettings]);
  
  // Gestão de Sessão do Usuário
  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      try {
        const profile = await userService.getCurrentUser(session.user.id);
        if (mounted) setUser(profile);
      } catch (error) {
        console.error('Não foi possível carregar o perfil autenticado:', error);
        await supabase.auth.signOut();
      }
    };
    void restoreSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setUser(null);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Atalho de teclado secreto para Admin Dashboard (Ctrl+Shift+A)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setActiveTab('admin-dashboard');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Mobile listeners removed

  // handleUnlock removed

  const handleLogout = () => {
    stopTracking();
    setTrackingStatus('idle');
    setUser(null);
    localStorage.removeItem('nbapark_user');
    void userService.signOut().catch(error => console.error('Erro ao encerrar sessão:', error));
  };

  useEffect(() => {
    if (user) {
      localStorage.setItem('nbapark_user', JSON.stringify(user));
      // Carregar reservas do Supabase se usuário estiver logado
      userService.getUserReservations(user.id)
        .then(resList => {
          setReservations(resList);
          // Retomar rastreamento automaticamente se houver corrida em andamento
          const activeTrip = resList.find(r => r.status === 'active');
          if (activeTrip && !isTrackingActive()) {
            startTracking(activeTrip.id, activeTrip.vehicle, activeTrip.employeeName)
              .then(started => setTrackingStatus(started ? 'active' : 'error'));
          }
        })
        .catch(err => console.error("Erro ao carregar reservas:", err));
    } else {
      stopTracking();
      setTrackingStatus('idle');
    }
  }, [user]);

  // Carregar dados iniciais do Cache (Apenas Resumo IA agora)
  useEffect(() => {
    // 2. Carregar Última Análise da Frota
    const savedSummary = localStorage.getItem('nbapark_summary');
    if (savedSummary) {
      setDashboardSummary(savedSummary);
    }

    // 3. Verificar Permissão de Geolocalização (Fix for User Request)
    if (user) {
      requestGeolocationPermission().then(status => {
        console.log('Geolocation permission status:', status);
        setGeoPermission(status);
        if (status === 'denied') {
          setNotification({
            show: true,
            type: 'warning',
            message: 'Permissão de localização negada. O rastreamento não funcionará.'
          });
          // Log permission denial for admin
          userService.logPermissionDenial(user.id, user.name);
        }
      });
    }
  }, [user]);

  // Sincronização de dados globais (apenas no dashboard)
  useEffect(() => {
    if (!user || activeTab !== 'dashboard') return;

    let isMounted = true;
    const fetchData = async () => {
      try {
        // Atualiza status global do veículo
        const activeTrips = await userService.getActiveReservations();
        if (isMounted) setGlobalActiveTrips(activeTrips);
        
        // Verificar se o veículo principal está bloqueado
        if (availableVehicles.length > 0) {
          const vehicleStatus = await adminService.isVehicleBlocked(availableVehicles[0].name);
          if (isMounted) setVehicleBlocked(vehicleStatus.blocked ? vehicleStatus.reason : null);
        }
      } catch (err) {
        if (isMounted) console.error("Erro ao sincronizar dados globais:", err);
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, [user?.id, activeTab, availableVehicles]);

  // Sincronização de dados do usuário
  useEffect(() => {
    if (!user) return;

    let isMounted = true;
    const fetchUserData = async () => {
      try {
        const [reservations, tasksCount] = await Promise.all([
          userService.getUserReservations(user.id),
          userService.getPendingTasksCount(user.id)
        ]);

        if (isMounted) {
          setReservations(reservations);
          setPendingTasksCount(tasksCount);
        }
      } catch (err) {
        if (isMounted) console.error("Erro ao sincronizar dados do usuário:", err);
      }
    };

    fetchUserData();
    return () => { isMounted = false; };
  }, [user?.id, activeTab]);

  // Notificações removidas

  // Salvar Resumo da IA no Cache sempre que mudar
  useEffect(() => {
    if (dashboardSummary) {
      localStorage.setItem('nbapark_summary', dashboardSummary);
    }
  }, [dashboardSummary]);

  // Limpar notificação automaticamente
  useEffect(() => {
    if (notification.show) {
      const timer = setTimeout(() => {
        setNotification(prev => ({ ...prev, show: false }));
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [notification.show]);

  // Função isolada para rodar a análise
  const runFleetAnalysis = useCallback(async () => {
    if (reservations.length === 0) {
      setDashboardSummary('');
      setFleetAnalysisError(null);
      return;
    }
    
    setIsAnalyzing(true);
    setFleetAnalysisError(null);
    
    try {
      const summary = await generateWeeklySummary(reservations);
      if (summary) {
        setDashboardSummary(summary);
      }
    } catch (e: any) {
      console.error("Falha na análise manual", e);
      setFleetAnalysisError(e.message || "Erro desconhecido ao analisar frota.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [reservations]);

  // Trigger automático
  useEffect(() => {
    if (activeTab === 'dashboard' && reservations.length > 0 && !dashboardSummary && !fleetAnalysisError) {
      runFleetAnalysis();
    }
  }, [activeTab, reservations.length, dashboardSummary, fleetAnalysisError, runFleetAnalysis]);

  const handleStartReservation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const formData = new FormData(e.currentTarget);
    const startOdo = Number(formData.get('startOdometer'));
    const name = formData.get('employeeName') as string;
    const itin = formData.get('itinerary') as string;
    const vehicle = formData.get('vehicle') as string;

    // Check if vehicle is blocked
    try {
      const vehicleStatus = await adminService.isVehicleBlocked(vehicle);
      if (vehicleStatus.blocked) {
        setNotification({
          show: true,
          type: 'error',
          message: `Veículo bloqueado: ${vehicleStatus.reason || 'Indisponível no momento'}`
        });
        setIsSubmitting(false);
        return;
      }

      // Check if vehicle is already occupied by another active trip
      const activeTripForVehicle = globalActiveTrips.find(t => t.vehicle === vehicle);
      if (activeTripForVehicle) {
        const otherAvailable = availableVehicles.find(v => 
          !v.isBlocked && 
          !globalActiveTrips.some(t => t.vehicle === v.name)
        );

        setOccupiedVehicleInfo({
          user: activeTripForVehicle.employeeName,
          vehicle: vehicle,
          otherAvailable: otherAvailable ? otherAvailable.name : undefined
        });
        setIsSubmitting(false);
        return;
      }
    } catch (error) {
      console.error('Error checking vehicle status:', error);
      // Continue anyway if check fails
    }

    const newRes: Reservation = {
      id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      employeeName: user?.name || name, // Prioriza usuário logado
      vehicle: vehicle,
      startOdometer: startOdo,
      itinerary: itin,
      startTime: new Date().toISOString(),
      status: 'active'
    };

    try {
      if (user) {
        // Verificar se usuário ainda existe antes de criar reserva
        const userStillExists = await userService.validateUserExists(user.id);
        if (!userStillExists) {
          alert("Sua sessão expirou ou é inválida. Por favor, faça login novamente.");
          setUser(null);
          localStorage.removeItem('nbapark_user');
          setIsSubmitting(false);
          return;
        }
        await userService.createReservation(newRes, user.id);
      }
      
      // Dispara Webhook de Início
      sendWebhook({
        event: 'trip_start',
        tripId: newRes.id,
        motorista: newRes.employeeName,
        vehicle: vehicle,
        km_inicial: startOdo,
        itinerary: itin
      });

      // Start GPS tracking for this trip
      try {
        const trackingStarted = await startTracking(newRes.id, vehicle, newRes.employeeName);
        setTrackingStatus(trackingStarted ? 'active' : 'error');
        if (trackingStarted) {
          console.log('GPS tracking started for trip:', newRes.id);
        }
      } catch (trackError) {
        console.error('Failed to start GPS tracking:', trackError);
        setTrackingStatus('error');
      }

      setReservations(prev => [newRes, ...prev]);
      setIsSubmitting(false);
      setActiveTab('dashboard');
    } catch (error) {
       console.error("Erro ao criar reserva:", error);
       alert("Erro ao salvar registro no banco de dados.");
       setIsSubmitting(false);
       return;
    }
    
    // Tenta analisar com contexto rico (sem geolocalização do dispositivo)
    analyzeItinerary({
      itinerary: itin,
      vehicle: vehicle,
      startOdometer: startOdo,
      employeeName: name,
      startTime: newRes.startTime
    })
      .then((summary) => {
        if (summary) setDashboardSummary(summary);
      })
      .catch((err) => {
        console.error("Erro na análise:", err);
        const msg = err.message === 'API_KEY_MISSING' 
          ? 'Chave da API Gemini não configurada! Verifique o arquivo .env.local' 
          : err.message;
          
        setNotification({
          show: true,
          type: 'warning',
          message: `Erro na IA: ${msg}`
        });
      });
  };

  const initiateEndTrip = (id: string) => {
    const val = endKmValues[id];
    const trip = reservations.find(r => r.id === id);
    
    if (!trip) return;
    
    if (!val || val.trim() === "") {
      alert("Por favor, digite o KM final antes de encerrar.");
      return;
    }

    const endKm = Number(val);
    if (isNaN(endKm)) {
      alert("Valor de KM inválido.");
      return;
    }

    if (endKm < trip.startOdometer) {
      alert(`O KM final (${endKm}) deve ser maior ou igual ao inicial (${trip.startOdometer}).`);
      return;
    }

    setConfirmingId(id);
  };

  const confirmEndTrip = (id: string) => {
    const endKm = Number(endKmValues[id]);
    const trip = reservations.find(r => r.id === id);

    // Interrompe imediatamente o hardware de GPS no dispositivo
    stopTracking();
    setTrackingStatus('idle');
    
    const updatedTrip = {
       ...trip,
       endOdometer: endKm,
       endTime: new Date().toISOString(),
       status: 'completed' as const
    };

    // Atualizar no Supabase
    const userId = user?.id || 'unknown';
    userService.updateReservation(updatedTrip as Reservation, userId)
      .then(() => {
          // Dispara Webhook de Encerramento (apenas se salvou ok)
          if (trip) {
            sendWebhook({
              event: 'trip_end',
              tripId: trip.id,
              motorista: trip.employeeName,
              vehicle: trip.vehicle,
              km_inicial: trip.startOdometer,
              km_final: endKm,
              km_total: endKm - trip.startOdometer,
              duracao_minutos: Math.round((new Date().getTime() - new Date(trip.startTime).getTime()) / 60000)
            });

            console.log('GPS tracking stopped for trip:', trip.id);
          }
         
         setReservations(prev => prev.map(res => {
          if (res.id === id) {
            return updatedTrip as Reservation;
          }
          return res;
        }));
        
        triggerSuccessAnimation();
      })
      .catch(err => {
        console.error("Erro ao finalizar viagem:", err);
        alert("Erro ao salvar finalização. Tente novamente.");
      });

    setConfirmingId(null);
    setEndKmValues(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const triggerSuccessAnimation = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }

    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch (e) {
      console.debug("Audio feedback prevented", e);
    }

    setShowSuccessOverlay(true);
    setTimeout(() => {
      setShowSuccessOverlay(false);
      setActiveTab('history');
    }, 1800);
  };

  const updateEndKmValue = (id: string, value: string) => {
    setEndKmValues(prev => ({ ...prev, [id]: value }));
    if (confirmingId === id) setConfirmingId(null);
  };

  const activeTrips = reservations.filter(r => r.status === 'active');
  const completedTrips = reservations.filter(r => r.status === 'completed');

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (!user) {
    return <UserLogin onLogin={setUser} appSettings={appSettings} />;
  }

  // Lock screen check removed

  if (activeTab === 'admin-dashboard') {
    if (user?.role !== 'admin') {
      setActiveTab('dashboard'); // Redirect if not admin
      return null;
    }
    return <AdminDashboard onExit={() => setActiveTab('dashboard')} currentUser={user} appSettings={appSettings} onSettingsChange={fetchAppSettings} />;
  }

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} appSettings={appSettings}>
      
      {/* Sistema de Notificação Toast no estilo Apple iOS */}
      {notification.show && (
        <div className="fixed top-4 left-4 right-4 max-w-sm mx-auto z-[110] apple-glass-dock p-3.5 rounded-3xl shadow-glass-float animate-slideUp border border-white/80 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-sm shadow-xs ${
            notification.type === 'error' ? 'bg-red-50 text-nba-red' : notification.type === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-nba-blue'
          }`}>
            <i className={`fas ${notification.type === 'error' ? 'fa-circle-xmark' : notification.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 tracking-tight leading-none">
              {notification.type === 'error' ? 'Atenção' : notification.type === 'warning' ? 'Aviso' : 'Sucesso'}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500 truncate">{notification.message}</p>
          </div>
          <button 
            onClick={() => setNotification({ ...notification, show: false })} 
            className="apple-tap w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>
      )}

      {/* Overlay de Sucesso no estilo Apple Modal */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-md animate-fadeIn p-4">
          <div className="apple-glass-card p-8 rounded-[36px] shadow-glass-float text-center animate-scaleIn relative overflow-hidden max-w-xs w-full border border-white/90">
            <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500 to-teal-400 text-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30">
              <i className="fas fa-check text-2xl animate-bounceIn"></i>
            </div>
            
            <h3 className="text-slate-900 text-lg font-bold tracking-tight mb-1 animate-slideUp">
              Viagem Finalizada
            </h3>
            
            <p className="text-slate-400 font-semibold text-xs tracking-wider uppercase animate-slideUp">
              Dados salvos com sucesso
            </p>
          </div>
        </div>
      )}

      {/* Admin Quick Access Button no estilo Apple Pill */}
      {activeTab === 'dashboard' && user?.role === 'admin' && (
        <button
          onClick={() => setActiveTab('admin-dashboard')}
          className="fixed top-3 left-3 md:top-5 md:left-5 z-50 px-3.5 py-1.5 apple-glass-dock rounded-full text-slate-800 flex items-center gap-2 shadow-glass-sm hover:scale-105 active:scale-95 transition-all text-xs font-semibold border border-white/80"
          title="Painel Administrativo"
        >
          <i className="fas fa-shield-halved text-nba-blue"></i>
          <span className="hidden sm:inline">Admin</span>
        </button>
      )}

      {activeTab === 'dashboard' && (
        <div className="space-y-4 animate-fadeIn pb-6">
          
          {/* Permission Request Banner - Apple Glass Capsule */}
          {geoPermission !== 'granted' && (
             <div className="apple-glass-card p-4 rounded-3xl border border-amber-200/60 shadow-glass-sm relative overflow-hidden bg-gradient-to-br from-amber-50/50 to-white/80">
                <div className="flex justify-between items-center relative z-10 gap-3">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-500/15 border border-amber-500/20 rounded-2xl flex items-center justify-center text-amber-600 text-lg shadow-xs">
                         <i className="fas fa-location-dot animate-bounce"></i>
                      </div>
                      <div>
                         <h3 className="text-slate-900 font-bold text-sm tracking-tight leading-none">GPS Necessário</h3>
                         <p className="text-slate-500 text-[11px] font-medium mt-1">Habilite para registrar viagens com precisão</p>
                      </div>
                   </div>
                   <button 
                      onClick={async () => {
                        const status = await requestGeolocationPermission();
                        setGeoPermission(status);
                        
                        if (status === 'denied') {
                          setShowLocationHelp(true);
                          if (user) {
                            userService.logPermissionDenial(user.id, user.name);
                          }
                        }
                      }}
                      className="apple-tap bg-amber-500 hover:bg-amber-600 text-white font-bold px-3.5 py-2 rounded-full text-xs shadow-sm transition-colors flex items-center gap-1.5 whitespace-nowrap"
                   >
                      <i className="fas fa-check text-[10px]"></i>
                      <span>{geoPermission === 'denied' ? 'Ajuda' : 'Permitir'}</span>
                   </button>
                </div>
             </div>
          )}

          {/* Modal de Ajuda de Localização */}
          {showLocationHelp && (
            <LocationHelpModal onClose={() => setShowLocationHelp(false)} />
          )}

          {/* Card de Inteligência de Frota - Apple Intelligence Style */}
          {(reservations.length > 0) && (
            <>
              {fleetAnalysisError ? (
                <div className="apple-glass-card p-4 rounded-3xl border border-red-200/60 shadow-glass-sm relative overflow-hidden bg-gradient-to-br from-red-50/40 to-white/80">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-red-50 text-nba-red flex items-center justify-center text-sm shadow-xs">
                        <i className="fas fa-triangle-exclamation"></i>
                      </div>
                      <div>
                        <h3 className="font-bold text-xs uppercase tracking-wider text-nba-red">Atenção na Análise</h3>
                        <p className="text-[10px] text-slate-400 font-medium">Conexão com Gemini AI indisponível</p>
                      </div>
                    </div>
                    <button 
                      onClick={runFleetAnalysis} 
                      className="apple-tap text-slate-400 hover:text-nba-red p-1.5 rounded-full transition-all"
                      title="Tentar Novamente"
                    >
                      <i className="fas fa-arrow-rotate-right text-xs"></i>
                    </button>
                  </div>
                  <p className="text-xs font-normal text-slate-600 mt-1">
                    {fleetAnalysisError}
                  </p>
                  <div className="mt-3 flex">
                     <button onClick={runFleetAnalysis} className="apple-tap text-[11px] font-bold text-white bg-nba-red px-3.5 py-1.5 rounded-full hover:bg-red-700 transition-colors shadow-sm">
                        Tentar Novamente
                     </button>
                  </div>
                </div>
              ) : (
                <div className="apple-glass-card p-4 rounded-3xl border border-white/80 shadow-glass-sm relative overflow-hidden group">
                  <div className="absolute -right-10 -top-10 w-36 h-36 bg-blue-400/10 rounded-full blur-2xl pointer-events-none"></div>

                  <div className="flex justify-between items-center mb-2 relative z-10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/15 flex items-center justify-center text-nba-blue shadow-xs">
                        <i className={`fas fa-brain text-xs ${isAnalyzing ? 'animate-pulse' : ''}`}></i>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-900 leading-none">Inteligência de Frota</h3>
                          <span className="text-[9px] font-bold text-nba-blue bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100">AI</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">Insights em tempo real</p>
                      </div>
                    </div>
                    <button 
                      onClick={runFleetAnalysis} 
                      disabled={isAnalyzing}
                      className="apple-tap w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-[11px] transition-colors disabled:opacity-40"
                      title="Atualizar Análise"
                    >
                      <i className={`fas fa-arrows-rotate ${isAnalyzing ? 'animate-spin' : ''}`}></i>
                    </button>
                  </div>

                  <div className="relative z-10 text-xs text-slate-600 font-normal leading-relaxed bg-white/50 p-3 rounded-2xl border border-black/[0.03]">
                    {isAnalyzing ? (
                       <div className="flex items-center space-x-2 text-nba-blue text-xs font-medium py-1">
                         <i className="fas fa-circle-notch animate-spin text-xs"></i>
                         <span>Processando dados da frota...</span>
                       </div>
                    ) : (
                       <p className="italic">
                         {dashboardSummary || "Aguardando dados suficientes para gerar insights de performance..."}
                       </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Botão de Nova Saída (Visível no Desktop) */}
          <div className="hidden md:block">
            <button 
              onClick={() => setActiveTab('new-reservation')}
              className="apple-tap w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#C8102E] to-[#E02446] text-white font-bold text-sm shadow-md shadow-red-500/25 flex items-center justify-center gap-2 hover:opacity-95 transition-all"
            >
              <i className="fas fa-plus text-xs"></i>
              <span>INICIAR NOVA VIAGEM</span>
            </button>
          </div>

          {/* Pending Tasks Alert */}
          {pendingTasksCount > 0 && (
            <div 
              onClick={() => setActiveTab('todo')}
              className="apple-tap apple-glass-card p-4 rounded-3xl border border-blue-200/50 shadow-glass-sm relative overflow-hidden cursor-pointer bg-gradient-to-r from-blue-50/70 to-slate-50/70"
            >
                <div className="flex justify-between items-center relative z-10">
                  <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-nba-blue text-white rounded-2xl flex items-center justify-center text-sm shadow-sm">
                        <i className="fas fa-clipboard-list"></i>
                      </div>
                      <div>
                        <h3 className="text-slate-900 font-bold text-sm leading-tight">Tarefas Pendentes</h3>
                        <p className="text-slate-500 text-[11px] font-medium mt-0.5">Você tem {pendingTasksCount} atividades</p>
                      </div>
                  </div>
                  <div className="apple-tap px-3 py-1.5 rounded-full bg-nba-blue/10 text-nba-blue text-xs font-bold flex items-center gap-1">
                      <span>Ver</span>
                      <i className="fas fa-chevron-right text-[9px]"></i>
                  </div>
                </div>
            </div>
          )}
          
          {/* Card de Status Global do Veículo - Apple Glass */}
          {vehicleBlocked ? (
             <div className="apple-glass-card p-4 rounded-3xl border border-amber-200/70 shadow-glass-sm bg-gradient-to-br from-amber-50/50 to-white/80">
                <div className="flex justify-between items-start">
                   <div className="flex items-center gap-3">
                      <div className="w-11 h-11 bg-amber-500/15 border border-amber-500/20 rounded-2xl flex items-center justify-center text-amber-600 text-lg shadow-xs">
                         <i className="fas fa-lock"></i>
                      </div>
                      <div>
                         <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Veículo Bloqueado</h2>
                         </div>
                         <p className="text-xs text-slate-500 font-medium mt-0.5">{vehicleBlocked}</p>
                      </div>
                   </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5 font-medium">
                   <i className="fas fa-info-circle text-xs text-amber-500"></i>
                   Contate o administrador para liberação.
                </p>
             </div>
          ) : globalActiveTrips.length > 0 ? (
             <div className="apple-glass-card p-4 rounded-3xl border border-red-200/70 shadow-glass-sm bg-gradient-to-br from-red-50/40 to-white/80">
                <div className="flex items-center justify-between mb-3">
                   <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-nba-red animate-ping"></span>
                      <h2 className="text-sm font-bold text-slate-900 tracking-tight">Veículo(s) em Uso</h2>
                   </div>
                   <span className="text-[10px] font-bold text-nba-red bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                      {globalActiveTrips.length} Ativo(s)
                   </span>
                </div>
                
                <div className="space-y-2">
                  {globalActiveTrips.map(trip => (
                    <div key={trip.id} className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/70 border border-black/[0.04] shadow-xs">
                       <div className="w-8 h-8 bg-gradient-to-tr from-[#C8102E] to-[#E02446] text-white rounded-xl flex items-center justify-center font-bold text-xs shadow-xs">
                          {trip.employeeName.charAt(0)}
                       </div>
                       <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-slate-900 truncate">{trip.employeeName}</p>
                            <span className="text-[10px] font-semibold text-slate-400">
                              {new Date(trip.startTime).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                            {trip.vehicle || 'Veículo'} • em rota
                          </p>
                       </div>
                    </div>
                  ))}
                </div>
             </div>
          ) : (
             <div className="apple-glass-card p-4 rounded-3xl border border-emerald-200/70 shadow-glass-sm bg-gradient-to-br from-emerald-50/50 to-white/80">
                <div className="flex justify-between items-center">
                   <div className="flex items-center gap-3">
                      <div className="w-11 h-11 bg-emerald-500/15 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-600 text-lg shadow-xs">
                         <i className="fas fa-key"></i>
                      </div>
                      <div>
                         <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Veículo Disponível</h2>
                         </div>
                         <p className="text-xs text-slate-500 font-medium mt-0.5">Livre para novo registro de saída</p>
                      </div>
                   </div>
                   <button
                     onClick={() => setActiveTab('new-reservation')}
                     className="apple-tap px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1"
                   >
                     <span>Retirar</span>
                     <i className="fas fa-arrow-right text-[10px]"></i>
                   </button>
                </div>
             </div>
          )}

          {/* Seção Suas Atividades */}
          <div className="pt-2">
            <div className="flex items-center justify-between px-1 mb-3">
              <div className="flex items-center gap-2">
                <i className="fas fa-route text-nba-blue text-xs"></i>
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Suas Atividades
                </h2>
              </div>
              <span className="bg-blue-50 text-nba-blue text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-blue-100">
                {activeTrips.length} Ativa(s)
              </span>
            </div>
            
            {activeTrips.length === 0 ? (
              <div className="apple-glass-card p-6 rounded-3xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-center opacity-70">
                <i className="fas fa-car-side text-slate-300 text-2xl mb-2"></i>
                <p className="font-semibold text-slate-400 text-xs">Você não está utilizando nenhum veículo agora</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeTrips.map(trip => (
                  <div key={trip.id} className="apple-glass-card p-4 rounded-3xl border border-white/80 shadow-glass-sm transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                         <div className="flex items-center gap-2 mb-1">
                            <span className="bg-nba-blue/10 text-nba-blue border border-nba-blue/20 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase flex items-center gap-1">
                                <i className="fas fa-car-side text-[9px]"></i>
                                {trip.vehicle || 'Veículo'}
                            </span>
                         </div>
                        <h4 className="font-bold text-slate-900 text-base tracking-tight leading-tight">{trip.employeeName}</h4>
                        <div className="flex gap-2 mt-1.5">
                          <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-slate-200/50">
                            KM: {trip.startOdometer}
                          </span>
                          <span className="bg-blue-50 text-nba-blue text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-blue-100">
                            Saída: {new Date(trip.startTime).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full border border-emerald-100">
                           <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                           <span className="text-[9px] font-bold tracking-wider">Em Rota</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-slate-50/80 p-3 rounded-2xl mb-4 text-xs border border-black/[0.03]">
                      <p className="text-slate-400 font-semibold text-[9px] uppercase tracking-wider mb-0.5">Itinerário</p>
                      <p className="text-slate-700 font-medium italic">"{trip.itinerary}"</p>
                    </div>

                    {confirmingId === trip.id ? (
                      <div className="apple-glass-card p-4 rounded-2xl flex flex-col gap-3 animate-fadeIn border border-amber-200/60 relative overflow-hidden bg-gradient-to-br from-amber-50/40 to-white/90">
                        <div className="flex items-center gap-2.5">
                           <div className="w-9 h-9 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center text-sm shadow-xs">
                             <i className="fas fa-triangle-exclamation"></i>
                           </div>
                           <div>
                             <h4 className="font-bold text-slate-900 text-xs">Confirmar Encerramento</h4>
                             <p className="text-[10px] font-medium text-slate-400">Deseja finalizar esta viagem?</p>
                           </div>
                        </div>
                        
                        <div className="bg-white/80 rounded-xl p-3 text-center border border-black/[0.04] flex items-baseline justify-center gap-1 shadow-xs">
                           <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">KM Final:</span>
                           <span className="text-xl font-bold text-slate-900">{endKmValues[trip.id]}</span>
                           <span className="text-xs font-semibold text-slate-400">KM</span>
                        </div>
                        
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setConfirmingId(null)}
                            className="apple-tap flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-semibold text-xs hover:bg-slate-200 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={() => confirmEndTrip(trip.id)}
                            className="apple-tap flex-[1.4] bg-gradient-to-r from-nba-red to-red-600 text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:opacity-95 transition-all flex items-center justify-center gap-1.5"
                          >
                            <span>Confirmar</span>
                            <i className="fas fa-check text-[10px]"></i>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <div className="flex-1 relative group">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <i className="fas fa-gauge-high text-slate-400 group-focus-within:text-nba-blue transition-colors text-xs"></i>
                          </div>
                          <input 
                            type="number" 
                            inputMode="numeric"
                            value={endKmValues[trip.id] || ''}
                            onChange={(e) => updateEndKmValue(trip.id, e.target.value)}
                            placeholder="KM Final" 
                            className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 focus:bg-white focus:border-nba-blue focus:ring-2 focus:ring-blue-500/10 outline-none text-xs font-bold transition-all text-slate-800 placeholder-slate-400"
                          />
                        </div>
                        <button 
                          onClick={() => initiateEndTrip(trip.id)}
                          className="apple-tap bg-gradient-to-r from-nba-red to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold px-4 py-2.5 rounded-2xl shadow-sm active:scale-95 transition-all text-xs flex items-center justify-center gap-1.5"
                        >
                          <span>Encerrar</span>
                          <i className="fas fa-flag-checkered text-[10px]"></i>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new-reservation' && (
        <div className="animate-fadeIn max-w-xl mx-auto space-y-4">
          <div className="flex items-center mb-2">
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className="apple-tap mr-3 w-10 h-10 apple-glass-card rounded-full flex items-center justify-center text-slate-700 shadow-sm border border-black/5 hover:bg-white transition-all"
            >
              <i className="fas fa-chevron-left text-xs"></i>
            </button>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Novo Registro de Saída</h2>
              <p className="text-[11px] font-medium text-slate-400">Preencha os dados da viagem</p>
            </div>
          </div>

          <form onSubmit={handleStartReservation} className="apple-glass-card p-5 md:p-6 rounded-[32px] shadow-glass-sm space-y-5 border border-white/80">
            <div className="space-y-4">
              
              {/* Seleção de Veículo */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Selecione o Veículo</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <i className="fas fa-car text-slate-400 group-focus-within:text-nba-blue transition-colors text-xs"></i>
                  </div>
                  <select 
                    required
                    name="vehicle"
                    className="w-full pl-9 pr-8 py-3 rounded-2xl bg-white/70 border border-slate-200/80 focus:bg-white focus:border-nba-blue focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-semibold text-slate-800 text-sm shadow-xs appearance-none"
                  >
                    {availableVehicles.map(v => (
                      <option key={v.id} value={v.name} disabled={v.isBlocked}>
                        {v.name} {v.status === 'Ocupado' ? '(Ocupado)' : v.isBlocked ? '(Bloqueado)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                     <i className="fas fa-chevron-down text-slate-400 text-xs"></i>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Responsável pelo Veículo</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <i className="fas fa-user-tie text-slate-400 group-focus-within:text-nba-blue transition-colors text-xs"></i>
                  </div>
                  <input 
                    required
                    name="employeeName"
                    type="text" 
                    defaultValue={user?.name}
                    readOnly
                    className="w-full pl-9 pr-4 py-3 rounded-2xl bg-slate-100/70 border border-slate-200/80 outline-none font-semibold text-slate-600 text-sm cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Odômetro Inicial</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                       <i className="fas fa-road text-slate-400 group-focus-within:text-nba-blue transition-colors text-xs"></i>
                    </div>
                    <input 
                      required
                      name="startOdometer"
                      type="number" 
                      placeholder="KM Atual"
                      className="w-full pl-9 pr-4 py-3 rounded-2xl bg-white/70 border border-slate-200/80 focus:bg-white focus:border-nba-blue focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-semibold text-slate-800 text-sm shadow-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Horário de Saída</label>
                  <div className="w-full px-4 py-3 rounded-2xl bg-slate-100/70 text-slate-600 font-semibold flex items-center border border-slate-200/80 text-sm">
                    <i className="fas fa-clock mr-2.5 text-nba-blue text-xs"></i>
                    {new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Objetivo e Destino</label>
                <textarea 
                  required
                  name="itinerary"
                  rows={3}
                  placeholder="Ex: Reunião Filial Sul + Abastecimento"
                  className="w-full p-3.5 rounded-2xl bg-white/70 border border-slate-200/80 focus:bg-white focus:border-nba-blue focus:ring-2 focus:ring-blue-500/10 outline-none transition-all font-medium text-slate-800 text-sm shadow-xs resize-none"
                ></textarea>
              </div>
            </div>

            <button 
              disabled={isSubmitting}
              className={`apple-tap w-full py-4 rounded-2xl text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
                isSubmitting 
                  ? 'bg-slate-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-nba-blue to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-blue-900/20 active:scale-[0.98]'
              }`}
            >
              {isSubmitting ? (
                <i className="fas fa-circle-notch animate-spin text-base"></i>
              ) : (
                <>
                  <i className="fas fa-check text-xs"></i>
                  <span>REGISTRAR SAÍDA</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="animate-fadeIn space-y-6">
          <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
            <div>
              <h2 className="text-xl font-black text-gray-800 uppercase italic leading-tight">Registros Passados</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Logs de quilometragem Fleet Control</p>
            </div>
            <div className="grid grid-cols-3 gap-2 w-full mt-4 md:mt-0 md:w-auto">
              <input 
                type="file" 
                accept=".csv"
                className="hidden"
                id="csv-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = (evt) => {
                    const text = evt.target?.result as string;
                    if (!text) return;

                    try {
                      const lines = text.split('\n');
                      // Remove header
                      const dataLines = lines.slice(1).filter(l => l.trim() !== '');
                      
                      const parsedReservations: Reservation[] = dataLines.map(line => {
                        // Regex simples para CSV (considerando que não há vírgulas DENTRO dos campos além do itinerário que está entre aspas)
                        // Limitação: isso falha se houver inputs complexos, mas funciona para o formato exportado
                        const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
                        // Fallback split se regex falhar
                        const splitCols = line.split(','); 
                        
                        // Função helper para limpar aspas
                        const clean = (s: string) => s ? s.replace(/^"|"$/g, '') : '';
                        
                        // Parse da data PT-BR (dd/mm/yyyy hh:mm:ss ou dd/mm/yyyy, hh:mm:ss) para ISO
                        const parseDate = (d: string) => {
                          const cleanD = clean(d);
                          if (!cleanD || cleanD === '-') return undefined;
                          
                          // Tenta formato ISO direto
                          if (cleanD.includes('-') && cleanD.includes('T')) return new Date(cleanD).toISOString();

                          // Tenta parse de formatos locais PT-BR
                          if (cleanD.includes('/')) {
                             // Remove virgula extra se houver e divide por espaço
                             const parts = cleanD.replace(',', '').split(' ');
                             const datePart = parts[0]; 
                             const timePart = parts[1] || '00:00:00';
                             
                             const [day, month, year] = datePart.split('/').map(Number);
                             const [hours, minutes, seconds] = timePart.split(':').map(Number);
                             
                             if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                                return new Date(year, month - 1, day, hours || 0, minutes || 0, seconds || 0).toISOString();
                             }
                          }
                          
                          // Fallback
                          try {
                            return new Date(cleanD).toISOString();
                          } catch (e) {
                            return undefined;
                          }
                        };

                        // Mapeamento baseado na ordem do Export:
                        // ID[0], Motorista[1], Veículo[2], Saída[3], Chegada[4], KM Ini[5], KM Fim[6], KM Total[7], Itin[8]
                        const p: string[] = [];
                        let display = '';
                        let inQuote = false;
                        for (let i = 0; i < line.length; i++) {
                          const char = line[i];
                          if (char === '"') { inQuote = !inQuote; continue; }
                          if (char === ',' && !inQuote) { p.push(display); display = ''; continue; }
                          display += char;
                        }
                        p.push(display);

                        return {
                          id: p[0],
                          employeeName: p[1],
                          vehicle: p[2],
                          startOdometer: Number(p[5]),
                          endOdometer: p[6] !== '-' ? Number(p[6]) : undefined,
                          startTime: parseDate(p[3]) || new Date().toISOString(),
                          endTime: parseDate(p[4]),
                          itinerary: p[8].replace(/""/g, '"'), // Unescape double quotes
                          status: (p[6] !== '-' && p[4] !== '-') ? 'completed' : 'active'
                        };
                      });

                      // Merge evitando duplicatas
                      setReservations(prev => {
                        const newIds = new Set(parsedReservations.map(r => r.id));
                        const filteredPrev = prev.filter(r => !newIds.has(r.id));
                        return [...parsedReservations, ...filteredPrev].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
                      });
                      
                      alert(`${parsedReservations.length} registros importados com sucesso!`);
                      e.target.value = ''; // Reset input

                    } catch (err) {
                      console.error(err);
                      alert("Erro ao importar CSV. Verifique o formato do arquivo.");
                    }
                  };
                  reader.readAsText(file);
                }}
              />
              <button 
                onClick={() => document.getElementById('csv-upload')?.click()}
                className="flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-600 p-3 rounded-2xl transition-all active:scale-95 border border-gray-100 shadow-sm"
              >
                <i className="fas fa-file-import text-xl mb-1 text-nba-blue"></i>
                <span className="text-[9px] font-black uppercase tracking-wide">Importar</span>
              </button>
              <button 
                onClick={() => {
                  const headers = ["ID", "Motorista", "Veículo", "Saída", "Chegada", "KM Inicial", "KM Final", "KM Total", "Itinerário"];
                  const csvContent = [
                    headers.join(","),
                    ...reservations.map(r => {
                      const kmTotal = r.endOdometer ? (r.endOdometer - r.startOdometer) : 0;
                      return [
                        r.id,
                        `"${r.employeeName}"`,
                        `"${r.vehicle}"`,
                        new Date(r.startTime).toISOString(), // Changed to ISO
                        r.endTime ? new Date(r.endTime).toISOString() : "-", // Changed to ISO
                        r.startOdometer,
                        r.endOdometer || "-",
                        kmTotal,
                        `"${r.itinerary.replace(/"/g, '""')}"`
                      ].join(",");
                    })
                  ].join("\n");

                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.setAttribute("href", url);
                  link.setAttribute("download", `frota_nbapark_${new Date().toISOString().split('T')[0]}.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="flex flex-col items-center justify-center bg-blue-50 hover:bg-blue-100 text-nba-blue p-3 rounded-2xl transition-all active:scale-95 border border-blue-100 shadow-sm"
              >
                <i className="fas fa-file-export text-xl mb-1"></i>
                <span className="text-[9px] font-black uppercase tracking-wide">Baixar</span>
              </button>
              <button 
                onClick={() => {
                  if(confirm('Deseja sair da sua conta?')) {
                    setUser(null);
                    setReservations([]);
                    localStorage.removeItem('nbapark_user');
                    localStorage.removeItem('nbapark_summary');
                  }
                }}
                className="flex flex-col items-center justify-center bg-red-50 hover:bg-red-100 text-nba-red p-3 rounded-2xl transition-all active:scale-95 border border-red-100 shadow-sm"
              >
                <i className="fas fa-trash-alt text-xl mb-1"></i>
                <span className="text-[9px] font-black uppercase tracking-wide">Limpar</span>
              </button>
            </div>
          </div>

          {completedTrips.length === 0 ? (
            <div className="bg-white p-20 rounded-[3rem] text-center shadow-inner border border-gray-100 border-dashed opacity-50">
               <i className="fas fa-history text-gray-200 text-7xl mb-6"></i>
               <p className="text-gray-400 font-black uppercase tracking-[0.3em] text-xs">Sem registros</p>
            </div>
          ) : (
            <div className="space-y-4 pb-10">
              {completedTrips.map(trip => {
                const kmDiff = (trip.endOdometer || 0) - trip.startOdometer;
                return (
                  <div key={trip.id} className="bg-white rounded-[2rem] overflow-hidden shadow-sm border border-gray-100 hover:border-nba-blue/30 transition-all group">
                    <div className="nba-blue text-white px-6 py-4 flex justify-between items-center group-hover:bg-blue-800 transition-colors">
                      <div className="flex items-center gap-3">
                        <i className="fas fa-check-circle text-green-400"></i>
                        <span className="text-sm font-black uppercase tracking-widest">{trip.employeeName}</span>
                      </div>
                      <span className="text-[10px] font-black opacity-60 bg-black/20 px-3 py-1 rounded-full uppercase">
                        {new Date(trip.startTime).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                      <div className="md:col-span-2">
                         <div className="flex items-center gap-2 mb-2">
                             <span className="text-[9px] font-black uppercase text-nba-blue bg-blue-50 px-2 py-1 rounded">
                                <i className="fas fa-car mr-1"></i>
                                {trip.vehicle || 'Polo Volkswagen'}
                             </span>
                         </div>
                        <p className="text-[8px] text-gray-400 font-black uppercase tracking-[0.2em] mb-2">Resumo da Viagem</p>
                        <p className="text-base font-bold text-gray-700 leading-snug underline decoration-nba-red/20 underline-offset-4 decoration-2">{trip.itinerary}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-2xl flex flex-col justify-center items-center border border-gray-100 shadow-inner">
                        <p className="text-[8px] text-gray-400 font-black uppercase mb-1">Rodagem</p>
                        <p className="text-3xl font-black text-nba-red leading-none">{kmDiff}<span className="text-xs ml-1">KM</span></p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-[9px] font-black text-gray-400 uppercase">Período</p>
                        <div className="text-[11px] font-bold text-gray-600 flex flex-col">
                           <span>{new Date(trip.startTime).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})} Saída</span>
                           <i className="fas fa-long-arrow-alt-down my-1 text-center text-gray-200"></i>
                           <span>{trip.endTime ? new Date(trip.endTime).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '--:--'} Volta</span>
                        </div>
                      </div>
                      <div className="md:col-span-4 border-t border-dashed pt-5 mt-2 flex flex-wrap justify-between items-center text-[10px] text-gray-400 font-black gap-4 uppercase tracking-tighter">
                        <div className="flex items-center gap-4 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
                           <span className="flex items-center gap-1"><i className="fas fa-play text-[8px] text-nba-blue"></i> INÍCIO: {trip.startOdometer} KM</span>
                           <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                           <span className="flex items-center gap-1"><i className="fas fa-stop text-[8px] text-nba-red"></i> FIM: {trip.endOdometer} KM</span>
                        </div>
                        <div className="flex items-center gap-2 text-nba-blue opacity-50">
                          <i className="fas fa-fingerprint"></i>
                          <span>ID: {trip.id.split('-')[1]}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'scheduling' && (
        <SchedulePage user={user} />
      )}

      {activeTab === 'global-history' && (
        <GlobalHistory />
      )}

      {activeTab === 'about' && (
        <div className="animate-fadeIn space-y-6">
          <div className="flex items-center mb-6">
            <button onClick={() => setActiveTab('dashboard')} className="mr-4 w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-nba-blue shadow-sm border border-gray-100 hover:shadow-md transition-all">
              <i className="fas fa-chevron-left"></i>
            </button>
            <h2 className="text-2xl font-black text-gray-800 uppercase italic tracking-tighter">Sobre</h2>
          </div>

          <div className="p-8 rounded-3xl shadow-xl relative overflow-hidden" style={{ backgroundColor: '#7cc6de' }}>
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-blue-50 rounded-full filter blur-3xl opacity-50"></div>
            
            <div className="relative z-10 text-center">
              <img src={appSettings?.logoUrl || "/logo.png"} alt="Logo" className="h-24 w-auto mx-auto mb-6" />
              
              <h3 className="text-2xl font-black text-nba-blue uppercase tracking-tight mb-2">{appSettings?.companyName || 'NBAPARK'}</h3>
              <p className="text-sm font-bold text-gray-600 uppercase tracking-widest mb-8">Controle de Frota</p>
              
              <div className="justify-left text-justify">
                <div  className="bg-gray-50 p-6 rounded-2xl border-l-4 border-nba-blue mb-6">
                  <p className="text-gray-700 font-medium leading-relaxed">
                    {appSettings?.aboutText || (
                      <>
                        Esta aplicação é <strong className="text-nba-blue">propriedade exclusiva da Fleet Control</strong>. 
                        Desenvolvida para otimizar o gerenciamento e controle da frota de veículos, 
                        proporcionando maior eficiência operacional e rastreabilidade completa das viagens.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3">
                  <div className="w-10 h-10 bg-nba-blue rounded-full flex items-center justify-center">
                    <i className="fa-solid fa-user-secret text-gray-500 text-xl"></i>
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Desenvolvido por</p>
                    <p className="text-[13px] font-black text-gray-500">TI Fleet Control</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-gray-100">
                <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                  &copy; {new Date().getFullYear()} Fleet Control. Todos os direitos reservados.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'todo' && (
        <TodoList />
      )}

      {/* Modal de Veículo Ocupado */}
      {occupiedVehicleInfo && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn p-4">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl text-center animate-scaleIn relative overflow-hidden max-w-sm w-full border border-red-100">
            <div className="absolute top-0 left-0 w-full h-2 bg-nba-red"></div>
            
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
              <i className="fas fa-car-side text-nba-red text-3xl animate-pulse"></i>
            </div>
            
            <h3 className="text-gray-800 text-xl font-black uppercase italic tracking-tighter mb-4">
              Veículo Indisponível
            </h3>
            
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-6">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Status Atual</p>
              <p className="text-sm font-bold text-gray-600">
                O veículo <span className="text-nba-red font-black">{occupiedVehicleInfo.vehicle}</span> já está sendo utilizado por <span className="text-nba-red font-black">{occupiedVehicleInfo.user}</span>.
              </p>
            </div>

            {occupiedVehicleInfo.otherAvailable ? (
              <div className="bg-green-50 p-4 rounded-2xl border border-green-100 mb-6">
                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Sugestão</p>
                <p className="text-sm font-bold text-green-700">
                  O veículo <span className="font-black">{occupiedVehicleInfo.otherAvailable}</span> está disponível no momento.
                </p>
              </div>
            ) : (
              <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 mb-6">
                <p className="text-xs font-bold text-orange-700">
                  Não há outros veículos disponíveis no momento.
                </p>
              </div>
            )}
            
            <button 
              onClick={() => setOccupiedVehicleInfo(null)}
              className="w-full py-4 bg-gray-800 text-white rounded-xl font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;
