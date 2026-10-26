import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  ClipboardCheck,
  CircleDollarSign,
  Clock3,
  Download,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Printer,
  QrCode,
  RefreshCw,
  Sandwich,
  Search,
  Sun,
  UserCog,
  Users,
  Wrench
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, clearAccessToken, getAccessToken, setAccessToken } from "./api";
import Terminals from "./Terminals";
import { AttendanceRequests, Managers, ManagerTeam } from "./AttendanceAdministration";

const Terminal = lazy(() => import("./Terminal"));

type Employee = {
  id: string;
  name: string;
  registration: string;
  status: string;
  department: { name: string } | null;
};

type EmployeeResponse = {
  items: Employee[];
  page: number;
  pageSize: number;
  total: number;
};

type Overview = {
  activeEmployees: number;
  employeesWithoutExit: number;
  todayPunches: number;
  missingMinutes: number;
  overtimeMinutes: number;
  todayMissingMinutes: number;
  todayOvertimeMinutes: number;
  warningDays: number;
  pendingRequests: number;
  eventTotals: Record<string, number>;
  employeeAttendance: {
    employeeId: string;
    name: string;
    missingMinutes: number;
    overtimeMinutes: number;
    warningDays: number;
  }[];
  latestEvents: {
    id: string;
    eventType: string;
    recordedAt: string;
    employee: { id: string; name: string; registration: string };
  }[];
};

type AuthUser = { id: string; name: string; email: string; role: string };
type QrStatus = "ACTIVE" | "REVOKED" | "NOT_ISSUED";
type ColorTheme = "light" | "dark";
const eventLabels: Record<string, string> = {
  ENTRY: "Entrada",
  BREAK_START: "Saída para intervalo",
  BREAK_END: "Retorno do intervalo",
  EXIT: "Saída final"
};
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getAccessToken()));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(!getAccessToken());
  const [theme, setTheme] = useState<ColorTheme>(() =>
    localStorage.getItem("vpan.theme") === "dark" ? "dark" : "light"
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("vpan.theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111827" : "#f6f8fc");
  }, [theme]);

  const toggleTheme = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  const signOut = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setIsAuthenticated(false);
    setAuthReady(true);
  }, []);

  useEffect(() => {
    window.addEventListener("auth-expired", signOut);
    return () => window.removeEventListener("auth-expired", signOut);
  }, [signOut]);

  useEffect(() => {
    if (!isAuthenticated || user) return;
    let disposed = false;
    void apiRequest<{ user: AuthUser }>("/auth/me")
      .then((response) => {
        if (!disposed) setUser(response.user);
      })
      .catch(() => {
        if (!disposed) signOut();
      })
      .finally(() => {
        if (!disposed) setAuthReady(true);
      });
    return () => {
      disposed = true;
    };
  }, [isAuthenticated, signOut, user]);

  if (window.location.pathname === "/terminal") {
    return (
      <Suspense fallback={<main className="terminal-setup-page">Carregando terminal...</main>}>
        <Terminal theme={theme} onToggleTheme={toggleTheme} />
      </Suspense>
    );
  }

  if (!isAuthenticated) {
    return (
      <Login
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthenticated={(nextUser) => {
          setUser(nextUser);
          setIsAuthenticated(true);
          setAuthReady(true);
        }}
      />
    );
  }

  if (!authReady) {
    return <main className="login-page">Carregando sessão...</main>;
  }

  const isAdmin = user?.role === "ADMIN";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sandwich size={21} />
          </div>
          <div>
            <strong>VPAN</strong>
            <span>GESTÃO DE JORNADA</span>
          </div>
        </div>
        <div className="side-label">MENU PRINCIPAL</div>
        <nav className="navigation">
          {isAdmin ? (
            <>
              <NavLink to="/" end className="nav-item">
                <Activity size={18} /> Visão geral
              </NavLink>
              <NavLink to="/funcionarios" className="nav-item">
                <Users size={18} /> Funcionários
              </NavLink>
              <NavLink to="/terminais" className="nav-item">
                <Monitor size={18} /> Terminais
              </NavLink>
              <NavLink to="/gestores" className="nav-item">
                <UserCog size={18} /> Gestores
              </NavLink>
            </>
          ) : (
            <NavLink to="/equipe" className="nav-item">
              <Users size={18} /> Minha equipe
            </NavLink>
          )}
          <NavLink to="/solicitacoes" className="nav-item">
            <ClipboardCheck size={18} /> Solicitações
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip">
            <div className="avatar">{user?.name.slice(0, 1).toUpperCase() ?? "A"}</div>
            <div className="user-copy">
              <strong>{user?.name ?? "Administrador"}</strong>
              <span>{user?.role === "MANAGER" ? "Gestor" : "Administrador"}</span>
            </div>
            <button className="icon-button" aria-label="Sair" onClick={signOut}>
              <LogOut size={17} />
            </button>
          </div>
          <div className="security-note">Acesso administrativo protegido</div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <span className="topbar-eyebrow">CONTROLE DE JORNADA</span>
          <div className="topbar-actions">
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Alternar tema">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>
            </button>
            <span className="topbar-status">
              <i /> Sistema conectado
            </span>
          </div>
        </header>
        <Routes>
          <Route path="/" element={isAdmin ? <Dashboard /> : <Navigate to="/equipe" replace />} />
          <Route path="/equipe" element={<ManagerTeam />} />
          <Route path="/solicitacoes" element={<AttendanceRequests isAdmin={isAdmin} />} />
          <Route
            path="/gestores"
            element={isAdmin ? <Managers /> : <Navigate to="/equipe" replace />}
          />
          <Route path="/funcionarios/:employeeId" element={<EmployeeDetails isAdmin={isAdmin} />} />
          <Route
            path="/funcionarios"
            element={isAdmin ? <Employees /> : <Navigate to="/equipe" replace />}
          />
          <Route
            path="/terminais"
            element={isAdmin ? <Terminals /> : <Navigate to="/equipe" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Login({
  onAuthenticated,
  theme,
  onToggleTheme
}: {
  onAuthenticated: (user: AuthUser) => void;
  theme: ColorTheme;
  onToggleTheme: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<{ accessToken: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      setAccessToken(result.accessToken);
      onAuthenticated(result.user);
      navigate("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <button
        className="theme-toggle login-theme-toggle"
        onClick={onToggleTheme}
        aria-label="Alternar tema"
      >
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>
      </button>
      <section className="login-card">
        <div className="brand login-brand">
          <div className="brand-mark">
            <Sandwich size={21} />
          </div>
          <div>
            <strong>VPAN</strong>
            <span>GESTÃO DE JORNADA</span>
          </div>
        </div>
        <div className="login-intro">
          <span className="eyebrow">ÁREA ADMINISTRATIVA</span>
          <h1>Acesse sua conta</h1>
          <p>Entre com suas credenciais administrativas para continuar.</p>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>
            E-mail
            <input autoComplete="username" name="email" type="email" required maxLength={254} />
          </label>
          <label>
            Senha
            <input
              autoComplete="current-password"
              name="password"
              type="password"
              required
              maxLength={128}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Entrando..." : "Entrar no painel"}
          </button>
        </form>
        <div className="login-foot">
          Acesso exclusivo para administradores e gestores autorizados.
        </div>
      </section>
    </main>
  );
}

function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiRequest<Overview>("/employees/overview"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar a visão geral.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RESUMO OPERACIONAL</span>
          <h1>Visão geral</h1>
          <p>Acompanhamento das pessoas e das marcações de hoje.</p>
        </div>
        <button className="secondary-button refresh-button" onClick={() => void loadOverview()}>
          <RefreshCw size={15} /> Atualizar
        </button>
      </div>
      {error && (
        <p className="form-error inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="overview-grid">
        <article className="overview-card">
          <div className="overview-icon blue">
            <Users size={19} />
          </div>
          <span>Funcionários ativos</span>
          <strong>{loading ? "—" : (data?.activeEmployees ?? 0)}</strong>
          <small>Cadastros ativos na empresa</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon green">
            <Activity size={19} />
          </div>
          <span>Em jornada, sem saída</span>
          <strong>{loading ? "—" : (data?.employeesWithoutExit ?? 0)}</strong>
          <small>Estimativa pelo último ponto registrado</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon violet">
            <CalendarClock size={19} />
          </div>
          <span>Marcações hoje</span>
          <strong>{loading ? "—" : (data?.todayPunches ?? 0)}</strong>
          <small>Eventos registrados no dia</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon amber">
            <Clock3 size={19} />
          </div>
          <span>Horas faltantes hoje</span>
          <strong>{loading ? "—" : formatMinutes(data?.todayMissingMinutes ?? 0)}</strong>
          <small>Após o encerramento da jornada</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon green">
            <Clock3 size={19} />
          </div>
          <span>Horas extras hoje</span>
          <strong>{loading ? "—" : formatMinutes(data?.todayOvertimeMinutes ?? 0)}</strong>
          <small>Com a tolerância configurada</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon amber">
            <CalendarClock size={19} />
          </div>
          <span>Faltantes no mês</span>
          <strong>{loading ? "—" : formatMinutes(data?.missingMinutes ?? 0)}</strong>
          <small>{data?.warningDays ?? 0} dias com alerta no espelho</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon violet">
            <CalendarClock size={19} />
          </div>
          <span>Extras no mês</span>
          <strong>{loading ? "—" : formatMinutes(data?.overtimeMinutes ?? 0)}</strong>
          <small>Horas apuradas no mês atual</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon blue">
            <ClipboardCheck size={19} />
          </div>
          <span>Pedidos pendentes</span>
          <strong>{loading ? "—" : (data?.pendingRequests ?? 0)}</strong>
          <small>
            <NavLink className="qr-action" to="/solicitacoes">
              Analisar solicitações
            </NavLink>
          </small>
        </article>
      </div>
      <div className="notice-panel overview-notice">
        <div className="notice-icon">
          <Activity size={19} />
        </div>
        <div>
          <strong>Marcações não comprovam presença física</strong>
          <p>
            “Em jornada” é uma estimativa baseada na última marcação, não confirma presença física.
            Os saldos usam os horários registrados e a jornada vigente em cada data.
          </p>
        </div>
      </div>
      <div className="event-totals" aria-label="Marcações por tipo">
        {Object.entries(eventLabels).map(([type, label]) => (
          <div className="event-total" key={type}>
            <span>{label}</span>
            <strong>{loading ? "—" : (data?.eventTotals[type] ?? 0)}</strong>
          </div>
        ))}
      </div>
      <div className="table-panel dashboard-events">
        <div className="table-toolbar">
          <div>
            <strong className="panel-title">Últimas marcações de hoje</strong>
            <p className="panel-subtitle">Horário oficial registrado pelo servidor.</p>
          </div>
          <span className="result-count">{data?.todayPunches ?? 0} no total</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>HORÁRIO</th>
                <th>FUNCIONÁRIO</th>
                <th>MARCAÇÃO</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="table-empty">
                    Carregando marcações...
                  </td>
                </tr>
              ) : data?.latestEvents.length ? (
                data.latestEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.recordedAt)}</td>
                    <td>
                      <span className="employee-name">{event.employee.name}</span>
                      <small className="table-secondary">{event.employee.registration}</small>
                    </td>
                    <td>{eventLabels[event.eventType] ?? event.eventType}</td>
                    <td>
                      <NavLink className="qr-action" to={`/funcionarios/${event.employee.id}`}>
                        Ver perfil
                      </NavLink>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="table-empty">
                    Nenhuma marcação registrada hoje.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="table-panel dashboard-events">
        <div className="table-toolbar">
          <div>
            <strong className="panel-title">Saldo por funcionário neste mês</strong>
            <p className="panel-subtitle">
              Dias incompletos e solicitações pendentes aparecem no espelho em amarelo.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>FUNCIONÁRIO</th>
                <th>HORAS FALTANTES</th>
                <th>HORAS EXTRAS</th>
                <th>DIAS COM ALERTA</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="table-empty">
                    Calculando saldos...
                  </td>
                </tr>
              ) : data?.employeeAttendance.length ? (
                data.employeeAttendance.map((employee) => (
                  <tr
                    key={employee.employeeId}
                    className={employee.warningDays ? "warning-row" : ""}
                  >
                    <td>
                      <NavLink
                        className="employee-profile-link employee-name"
                        to={`/funcionarios/${employee.employeeId}`}
                      >
                        {employee.name}
                      </NavLink>
                    </td>
                    <td>{formatMinutes(employee.missingMinutes)}</td>
                    <td>{formatMinutes(employee.overtimeMinutes)}</td>
                    <td>{employee.warningDays || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="table-empty">
                    Nenhum funcionário ativo cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

type EmployeePunchHistory = {
  employee: {
    id: string;
    name: string;
    registration: string;
    status: string;
    jobTitle: string | null;
    department: { name: string } | null;
    schedules: {
      id: string;
      effectiveFrom: string;
      days: {
        dayOfWeek: number;
        startTime: string | null;
        breakStartTime: string | null;
        breakEndTime: string | null;
        endTime: string | null;
      }[];
    }[];
  };
  items: {
    id: string;
    eventType: string;
    recordedAt: string;
    source: string;
    voidedAt: string | null;
    voidReason: string | null;
    terminal: { name: string } | null;
    targetRequests: { type: string; status: string; reason: string }[];
    resultRequests: { type: string; status: string; reason: string }[];
  }[];
  attendanceDays: {
    date: string;
    dayOfWeek: number;
    expectedMinutes: number;
    workedMinutes: number | null;
    missingMinutes: number;
    overtimeMinutes: number;
    waivedMinutes: number;
    status: string;
    warning: boolean;
    pendingRequest: boolean;
  }[];
};

type ScheduleDay = EmployeePunchHistory["employee"]["schedules"][number]["days"][number];
type PunchAction = { mode: "request" | "edit"; punchId?: string; date: string } | null;
const weekdayLabels = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function EmployeeDetails({ isAdmin }: { isAdmin: boolean }) {
  const { employeeId } = useParams();
  const [data, setData] = useState<EmployeePunchHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [scheduleDate, setScheduleDate] = useState(todayDateKey());
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [punchAction, setPunchAction] = useState<PunchAction>(null);
  const [requestType, setRequestType] = useState<
    "CORRECT_PUNCH" | "ADD_PUNCH" | "HOUR_WAIVER" | "VOID_PUNCH"
  >("CORRECT_PUNCH");
  const [selectedPunchId, setSelectedPunchId] = useState("");
  const [actionEventType, setActionEventType] = useState("ENTRY");
  const [actionRecordedAt, setActionRecordedAt] = useState("");
  const [actionMinutes, setActionMinutes] = useState(30);
  const [actionReason, setActionReason] = useState("");
  const [savingAction, setSavingAction] = useState(false);

  const loadEmployee = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest<EmployeePunchHistory>(`/employees/${employeeId}/punches`);
      setData(response);
      const today = todayDateKey();
      const currentSchedule = response.employee.schedules.find(
        (schedule) => schedule.effectiveFrom.slice(0, 10) <= today
      );
      setScheduleDays(
        currentSchedule?.days ?? weekdayLabels.map((_, index) => defaultScheduleDay(index + 1))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar o perfil.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void loadEmployee();
  }, [loadEmployee]);

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) return;
    setSavingSchedule(true);
    setScheduleMessage("");
    setError("");
    try {
      await apiRequest(`/employees/${employeeId}/schedules`, {
        method: "POST",
        body: JSON.stringify({ effectiveFrom: scheduleDate, days: scheduleDays })
      });
      setScheduleMessage("Jornada salva. A vigência começa na data selecionada.");
      await loadEmployee();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar a jornada.");
    } finally {
      setSavingSchedule(false);
    }
  }

  function updateScheduleDay(dayOfWeek: number, field: keyof ScheduleDay, value: string) {
    setScheduleDays((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, [field]: value || null } : day))
    );
  }

  function setRestDay(dayOfWeek: number, isRest: boolean) {
    setScheduleDays((current) =>
      current.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? isRest
            ? { ...day, startTime: null, breakStartTime: null, breakEndTime: null, endTime: null }
            : defaultScheduleDay(dayOfWeek)
          : day
      )
    );
  }

  function getPunchesForDate(date: string) {
    return (data?.items ?? []).filter(
      (punch) => !punch.voidedAt && saoPauloDateKeyForBrowser(punch.recordedAt) === date
    );
  }

  function openPunchAction(mode: "request" | "edit", date: string, punchId?: string) {
    const dayPunches = getPunchesForDate(date);
    const punch = dayPunches.find((item) => item.id === punchId) ?? dayPunches[0];
    setPunchAction({ mode, date, punchId: punch?.id });
    setSelectedPunchId(punch?.id ?? "");
    setRequestType(punch ? "CORRECT_PUNCH" : "HOUR_WAIVER");
    setActionEventType(punch?.eventType ?? "ENTRY");
    setActionRecordedAt(punch ? toSaoPauloDateTimeLocal(punch.recordedAt) : `${date}T08:00`);
    setActionMinutes(30);
    setActionReason("");
    setError("");
  }

  function selectActionPunch(punchId: string) {
    const punch = data?.items.find((item) => item.id === punchId);
    setSelectedPunchId(punchId);
    if (punch) {
      setActionEventType(punch.eventType);
      setActionRecordedAt(toSaoPauloDateTimeLocal(punch.recordedAt));
    }
  }

  async function submitPunchAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId || !punchAction) return;
    setSavingAction(true);
    setError("");
    try {
      if (punchAction.mode === "edit") {
        await apiRequest(`/employees/${employeeId}/punches/${selectedPunchId}`, {
          method: "PATCH",
          body: JSON.stringify({
            eventType: actionEventType,
            recordedAt: saoPauloDateTimeToIso(actionRecordedAt),
            reason: actionReason
          })
        });
      } else {
        const body: Record<string, string | number> = {
          employeeId,
          type: requestType,
          reason: actionReason
        };
        if (requestType === "VOID_PUNCH") {
          body.targetEventId = selectedPunchId;
        } else if (requestType === "HOUR_WAIVER") {
          body.targetDate = punchAction.date;
          body.minutes = actionMinutes;
        } else {
          body.eventType = actionEventType;
          body.recordedAt = saoPauloDateTimeToIso(actionRecordedAt);
          if (requestType === "CORRECT_PUNCH") body.targetEventId = selectedPunchId;
        }
        await apiRequest("/attendance-requests", {
          method: "POST",
          body: JSON.stringify(body)
        });
      }
      setPunchAction(null);
      await loadEmployee();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar o ajuste.");
    } finally {
      setSavingAction(false);
    }
  }

  async function voidPunch() {
    if (!employeeId || !punchAction || savingAction) return;
    if (!selectedPunchId) {
      setError("Selecione a marcação que deseja descartar.");
      return;
    }
    const reason = actionReason.trim();
    if (reason.length < 10 || reason.length > 500) {
      setError("Para descartar a marcação, informe uma justificativa entre 10 e 500 caracteres.");
      return;
    }
    setSavingAction(true);
    setError("");
    try {
      await apiRequest(`/employees/${employeeId}/punches/${selectedPunchId}`, {
        method: "DELETE",
        body: JSON.stringify({ reason })
      });
      setPunchAction(null);
      await loadEmployee();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao anular a marcação.");
    } finally {
      setSavingAction(false);
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <NavLink className="back-link" to="/funcionarios">
            <ArrowLeft size={15} /> Funcionários
          </NavLink>
          <span className="eyebrow">GESTÃO INDIVIDUAL</span>
          <h1>{data?.employee.name ?? "Perfil do funcionário"}</h1>
          <p>
            {data
              ? `${data.employee.registration} · ${data.employee.jobTitle ?? "Cargo não informado"} · ${data.employee.department?.name ?? "Sem departamento"}`
              : "Cadastro e histórico de marcações."}
          </p>
        </div>
        {data && (
          <span
            className={`status-pill ${data.employee.status === "ACTIVE" ? "active" : "inactive"}`}
          >
            {data.employee.status === "ACTIVE" ? "Ativo" : "Inativo"}
          </span>
        )}
      </div>
      {error && (
        <p className="form-error inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="overview-grid employee-summary">
        <article className="overview-card">
          <div className="overview-icon blue">
            <Clock3 size={19} />
          </div>
          <span>Marcações recentes</span>
          <strong>{loading ? "—" : (data?.items.length ?? 0)}</strong>
          <small>Até 50 registros mais recentes</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon amber">
            <CalendarClock size={19} />
          </div>
          <span>Horas faltantes no mês</span>
          <strong>
            {formatMinutes(
              data?.attendanceDays.reduce((sum, day) => sum + day.missingMinutes, 0) ?? 0
            )}
          </strong>
          <small>Abonos aprovados permanecem identificados</small>
        </article>
        <article className="overview-card">
          <div className="overview-icon green">
            <Clock3 size={19} />
          </div>
          <span>Horas extras no mês</span>
          <strong>
            {formatMinutes(
              data?.attendanceDays.reduce((sum, day) => sum + day.overtimeMinutes, 0) ?? 0
            )}
          </strong>
          <small>Somente dias apurados</small>
        </article>
      </div>
      <div className="table-panel mirror-panel">
        <div className="table-toolbar">
          <div>
            <strong className="panel-title">
              Espelho diário ·{" "}
              {new Intl.DateTimeFormat("pt-BR", {
                month: "long",
                year: "numeric",
                timeZone: "America/Sao_Paulo"
              }).format(new Date())}
            </strong>
            <p className="panel-subtitle">
              Dias em amarelo exigem conferência; abonos aprovados não apagam a ocorrência.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>DIA</th>
                <th>JORNADA</th>
                <th>TRABALHADO</th>
                <th>FALTANTES</th>
                <th>EXTRAS</th>
                <th>SITUAÇÃO</th>
                <th>AÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {data?.attendanceDays.length ? (
                data.attendanceDays.map((day) => (
                  <tr className={day.warning ? "warning-row" : ""} key={day.date}>
                    <td>{formatDateKey(day.date)}</td>
                    <td>{day.expectedMinutes ? formatMinutes(day.expectedMinutes) : "Folga"}</td>
                    <td>{day.workedMinutes === null ? "—" : formatMinutes(day.workedMinutes)}</td>
                    <td>{day.missingMinutes ? formatMinutes(day.missingMinutes) : "—"}</td>
                    <td>{day.overtimeMinutes ? formatMinutes(day.overtimeMinutes) : "—"}</td>
                    <td>{attendanceStatus(day.status, day.pendingRequest, day.waivedMinutes)}</td>
                    <td>
                      {day.warning && (!isAdmin || getPunchesForDate(day.date).length > 0) && (
                        <button
                          className="row-action-button"
                          title={
                            isAdmin
                              ? "Editar uma marcação deste dia"
                              : "Solicitar ajuste ou abono para este dia"
                          }
                          aria-label={
                            isAdmin
                              ? `Editar marcação de ${formatDateKey(day.date)}`
                              : `Solicitar ajuste para ${formatDateKey(day.date)}`
                          }
                          onClick={() => openPunchAction(isAdmin ? "edit" : "request", day.date)}
                        >
                          {isAdmin ? <Pencil size={16} /> : <CircleDollarSign size={17} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="table-empty">
                    {loading ? "Carregando espelho..." : "Sem dias para exibir."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {isAdmin && (
        <div className="table-panel schedule-editor-panel">
          <div className="table-toolbar">
            <div>
              <strong className="panel-title">Configurar jornada do funcionário</strong>
              <p className="panel-subtitle">
                A nova versão só vale a partir da data inicial e mantém o histórico anterior.
              </p>
            </div>
          </div>
          <form className="schedule-editor" onSubmit={(event) => void saveSchedule(event)}>
            <label className="schedule-effective-date">
              Início da vigência
              <input
                type="date"
                min={todayDateKey()}
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                required
              />
            </label>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>DIA</th>
                    <th>INÍCIO</th>
                    <th>SAÍDA INTERVALO</th>
                    <th>RETORNO</th>
                    <th>FIM</th>
                    <th>FOLGA</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleDays.map((day) => (
                    <tr key={day.dayOfWeek}>
                      <td>{weekdayLabels[day.dayOfWeek - 1]}</td>
                      {(["startTime", "breakStartTime", "breakEndTime", "endTime"] as const).map(
                        (field) => (
                          <td key={field}>
                            <input
                              aria-label={`${weekdayLabels[day.dayOfWeek - 1]} ${field}`}
                              type="time"
                              value={day[field] ?? ""}
                              disabled={!day.startTime}
                              onChange={(event) =>
                                updateScheduleDay(day.dayOfWeek, field, event.target.value)
                              }
                            />
                          </td>
                        )
                      )}
                      <td>
                        <input
                          aria-label={`${weekdayLabels[day.dayOfWeek - 1]} folga`}
                          type="checkbox"
                          checked={!day.startTime}
                          onChange={(event) => setRestDay(day.dayOfWeek, event.target.checked)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scheduleMessage && (
              <p className="success-message" role="status">
                {scheduleMessage}
              </p>
            )}
            <div className="schedule-actions">
              <button className="primary-button" disabled={savingSchedule}>
                {savingSchedule ? "Salvando..." : "Salvar nova jornada"}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="table-panel">
        <div className="table-toolbar">
          <div>
            <strong className="panel-title">Histórico de marcações</strong>
            <p className="panel-subtitle">Os registros são apresentados como gravados.</p>
          </div>
          <span className="result-count">{data?.items.length ?? 0} registros</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>DATA E HORA</th>
                <th>MARCAÇÃO</th>
                <th>ORIGEM</th>
                <th>TERMINAL</th>
                <th>AÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Carregando histórico...
                  </td>
                </tr>
              ) : data?.items.length ? (
                data.items.map((punch) => (
                  <tr
                    className={
                      getPunchesForDate(saoPauloDateKeyForBrowser(punch.recordedAt)).length > 0 &&
                      data.attendanceDays.find(
                        (day) => day.date === saoPauloDateKeyForBrowser(punch.recordedAt)
                      )?.warning
                        ? "warning-row"
                        : ""
                    }
                    key={punch.id}
                  >
                    <td>{formatDateTime(punch.recordedAt)}</td>
                    <td>
                      {eventLabels[punch.eventType] ?? punch.eventType}
                      {punch.voidedAt && (
                        <small className="table-secondary">
                          Anulado · {punch.voidReason ?? "Justificativa registrada"}
                        </small>
                      )}
                      {(punch.targetRequests.some((item) => item.status === "APPROVED") ||
                        punch.resultRequests.some((item) => item.status === "APPROVED")) && (
                        <small className="table-secondary">Alterado após aprovação</small>
                      )}
                    </td>
                    <td>
                      {punch.source === "QR_TERMINAL"
                        ? "Terminal QR"
                        : punch.source === "APPROVED_CORRECTION"
                          ? "Correção aprovada"
                          : punch.source === "ADMIN_CORRECTION"
                            ? "Correção administrativa"
                            : punch.source === "APPROVED_MISSING_PUNCH"
                              ? "Ponto incluído após aprovação"
                              : punch.source}
                    </td>
                    <td>{punch.terminal?.name ?? "—"}</td>
                    <td>
                      {punch.voidedAt ? (
                        <span className="voided-pill">Anulado</span>
                      ) : (
                        <button
                          className="row-action-button"
                          title={
                            isAdmin ? "Editar esta marcação" : "Solicitar ajuste desta marcação"
                          }
                          aria-label={
                            isAdmin ? "Editar esta marcação" : "Solicitar ajuste desta marcação"
                          }
                          onClick={() =>
                            openPunchAction(
                              isAdmin ? "edit" : "request",
                              saoPauloDateKeyForBrowser(punch.recordedAt),
                              punch.id
                            )
                          }
                        >
                          {isAdmin ? <Pencil size={16} /> : <Wrench size={16} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Nenhuma marcação registrada para este funcionário.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {punchAction && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="punch-action-title"
          >
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setPunchAction(null)}
            >
              ×
            </button>
            <span className="eyebrow">
              {punchAction.mode === "edit" ? "AJUSTE ADMINISTRATIVO" : "PEDIDO PARA APROVAÇÃO"}
            </span>
            <h2 id="punch-action-title">
              {punchAction.mode === "edit" ? "Editar marcação" : "Solicitar ajuste"}
            </h2>
            <p>
              {formatDateKey(punchAction.date)} · {data?.employee.name}
              {punchAction.mode === "request" &&
                " · o espelho só muda após a aprovação do administrador"}
            </p>
            <form className="form-stack" onSubmit={(event) => void submitPunchAction(event)}>
              {punchAction.mode === "request" && (
                <label>
                  O que você precisa?
                  <select
                    value={requestType}
                    onChange={(event) =>
                      setRequestType(
                        event.target.value as
                          "CORRECT_PUNCH" | "ADD_PUNCH" | "HOUR_WAIVER" | "VOID_PUNCH"
                      )
                    }
                  >
                    <option value="CORRECT_PUNCH">Corrigir ponto existente</option>
                    <option value="ADD_PUNCH">Incluir ponto esquecido</option>
                    <option value="HOUR_WAIVER">Solicitar abono de horas</option>
                    <option value="VOID_PUNCH">Descartar marcação incorreta</option>
                  </select>
                </label>
              )}
              {(punchAction.mode === "edit" ||
                requestType === "CORRECT_PUNCH" ||
                requestType === "VOID_PUNCH") && (
                <label>
                  Marcação selecionada
                  <select
                    value={selectedPunchId}
                    onChange={(event) => selectActionPunch(event.target.value)}
                    required
                  >
                    <option value="">Selecione o ponto</option>
                    {getPunchesForDate(punchAction.date).map((punch) => (
                      <option value={punch.id} key={punch.id}>
                        {eventLabels[punch.eventType] ?? punch.eventType} ·{" "}
                        {formatDateTime(punch.recordedAt)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {requestType === "HOUR_WAIVER" && punchAction.mode === "request" ? (
                <label>
                  Minutos para abono
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={actionMinutes}
                    onChange={(event) => setActionMinutes(Number(event.target.value))}
                    required
                  />
                </label>
              ) : requestType !== "VOID_PUNCH" || punchAction.mode === "edit" ? (
                <>
                  <label>
                    Tipo de marcação
                    <select
                      value={actionEventType}
                      onChange={(event) => setActionEventType(event.target.value)}
                    >
                      {Object.entries(eventLabels).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Data e hora
                    <input
                      type="datetime-local"
                      value={actionRecordedAt}
                      max={
                        punchAction.mode === "request"
                          ? toSaoPauloDateTimeLocal(new Date().toISOString())
                          : undefined
                      }
                      onChange={(event) => setActionRecordedAt(event.target.value)}
                      required
                    />
                  </label>
                </>
              ) : (
                <p>Somente esta marcação será descartada após a aprovação do administrador.</p>
              )}
              <label>
                Motivo / justificativa
                <textarea
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  aria-describedby="punch-action-reason-help"
                  minLength={10}
                  maxLength={500}
                  rows={3}
                  required
                />
                <small id="punch-action-reason-help">
                  Obrigatório para corrigir ou descartar: entre 10 e 500 caracteres.
                </small>
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                {punchAction.mode === "edit" && (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={savingAction}
                    onClick={() => void voidPunch()}
                  >
                    Descartar marcação
                  </button>
                )}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setPunchAction(null)}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  disabled={
                    savingAction ||
                    (punchAction.mode === "edit" && !selectedPunchId) ||
                    (punchAction.mode === "request" &&
                      (requestType === "CORRECT_PUNCH" || requestType === "VOID_PUNCH") &&
                      !selectedPunchId)
                  }
                >
                  {savingAction
                    ? "Salvando..."
                    : punchAction.mode === "edit"
                      ? "Salvar correção"
                      : "Enviar solicitação"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      <div className="notice-panel overview-notice">
        <div className="notice-icon">
          <Activity size={19} />
        </div>
        <div>
          <strong>Correções e abonos são auditados e dependem de aprovação</strong>
          <p>
            Os gestores enviam solicitações com justificativa; o administrador aprova ou rejeita.
            Correções preservam o valor anterior na trilha de auditoria. Abonos aprovados reduzem
            horas faltantes sem apagar a ocorrência do espelho.
          </p>
        </div>
      </div>
    </section>
  );
}

function Employees() {
  const [data, setData] = useState<EmployeeResponse | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [qrEmployee, setQrEmployee] = useState<Employee | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");

  const loadEmployees = useCallback(async (term: string) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: "1", pageSize: "50" });
      if (term.trim()) query.set("search", term.trim());
      setData(await apiRequest<EmployeeResponse>(`/employees?${query.toString()}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar funcionários.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEmployees("");
  }, [loadEmployees]);

  async function createEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest<Employee>("/employees", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          registration: form.get("registration"),
          jobTitle: form.get("jobTitle") || null
        })
      });
      setShowCreate(false);
      setSuccess("Funcionário cadastrado.");
      await loadEmployees(search);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao cadastrar funcionário.");
    } finally {
      setSaving(false);
    }
  }

  async function openQr(employee: Employee) {
    setQrEmployee(employee);
    setQrStatus(null);
    setQrToken(null);
    setQrError("");
    setQrLoading(true);
    try {
      const result = await apiRequest<{ status: QrStatus; token?: string }>(
        `/employees/${employee.id}/qr`
      );
      setQrStatus(result.status);
      setQrToken(result.token ?? null);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : "Falha ao consultar credencial QR.");
    } finally {
      setQrLoading(false);
    }
  }

  async function issueQr() {
    if (!qrEmployee) return;
    setQrLoading(true);
    setQrError("");
    try {
      const result = await apiRequest<{ status: QrStatus; token: string }>(
        `/employees/${qrEmployee.id}/qr`,
        { method: "POST" }
      );
      setQrStatus(result.status);
      setQrToken(result.token);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : "Falha ao gerar credencial QR.");
    } finally {
      setQrLoading(false);
    }
  }

  async function revokeQr() {
    if (!qrEmployee || !window.confirm(`Revogar a credencial QR de ${qrEmployee.name}?`)) return;
    setQrLoading(true);
    setQrError("");
    try {
      await apiRequest(`/employees/${qrEmployee.id}/qr/revoke`, { method: "POST" });
      setQrStatus("REVOKED");
      setQrToken(null);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : "Falha ao revogar credencial QR.");
    } finally {
      setQrLoading(false);
    }
  }

  function downloadQr() {
    const svg = document.getElementById("employee-qr-code");
    if (!(svg instanceof SVGSVGElement) || !qrEmployee) {
      setQrError("Não foi possível preparar o arquivo do QR Code.");
      return;
    }
    const source = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `qr-${qrEmployee.registration}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CADASTRO E CONSULTA</span>
          <h1>Funcionários</h1>
          <p>Consulte e gerencie os cadastros da empresa.</p>
        </div>
        <button className="primary-button compact" onClick={() => setShowCreate(true)}>
          Cadastrar funcionário
        </button>
      </div>
      <div className="table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadEmployees(search);
              }}
              placeholder="Buscar por nome ou matrícula"
            />
            <button onClick={() => void loadEmployees(search)}>Buscar</button>
          </div>
          <span className="result-count">{data?.total ?? 0} cadastros</span>
        </div>
        {success && (
          <p className="success-message" role="status">
            {success}
          </p>
        )}
        {error && (
          <p className="form-error inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>FUNCIONÁRIO</th>
                <th>MATRÍCULA</th>
                <th>DEPARTAMENTO</th>
                <th>SITUAÇÃO</th>
                <th>QR CODE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Carregando funcionários...
                  </td>
                </tr>
              ) : data?.items.length ? (
                data.items.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <NavLink
                        className="employee-profile-link employee-name"
                        to={`/funcionarios/${employee.id}`}
                      >
                        {employee.name}
                      </NavLink>
                    </td>
                    <td>{employee.registration}</td>
                    <td>{employee.department?.name ?? "—"}</td>
                    <td>
                      <span
                        className={`status-pill ${employee.status === "ACTIVE" ? "active" : "inactive"}`}
                      >
                        {employee.status === "ACTIVE" ? "Ativo" : employee.status}
                      </span>
                    </td>
                    <td>
                      <button className="qr-action" onClick={() => void openQr(employee)}>
                        <QrCode size={15} />
                        Gerenciar QR
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Nenhum funcionário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreate(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setShowCreate(false)}
            >
              ×
            </button>
            <span className="eyebrow">NOVO CADASTRO</span>
            <h2 id="create-title">Cadastrar funcionário</h2>
            <p>Funcionários não recebem conta de acesso ao painel.</p>
            <form className="form-stack" onSubmit={createEmployee}>
              <label>
                Nome completo
                <input name="name" required minLength={2} maxLength={160} />
              </label>
              <label>
                Matrícula interna
                <input name="registration" required maxLength={40} />
              </label>
              <label>
                Cargo (opcional)
                <input name="jobTitle" maxLength={120} />
              </label>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowCreate(false)}
                >
                  Cancelar
                </button>
                <button className="primary-button" disabled={saving}>
                  {saving ? "Salvando..." : "Cadastrar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {qrEmployee && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQrEmployee(null);
          }}
        >
          <section
            className="modal qr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-title"
          >
            <button className="modal-close" aria-label="Fechar" onClick={() => setQrEmployee(null)}>
              ×
            </button>
            <span className="eyebrow">CREDENCIAL INDIVIDUAL</span>
            <h2 id="qr-title">QR Code de {qrEmployee.name}</h2>
            <p>
              Matrícula {qrEmployee.registration}. O código é uma credencial compartilhável; não
              comprova sozinho a identidade de quem o apresenta.
            </p>
            {qrLoading ? (
              <div className="qr-state">Carregando credencial...</div>
            ) : qrToken ? (
              <div className="qr-print-area">
                <QRCodeSVG id="employee-qr-code" value={qrToken} size={230} level="M" />
                <span>Credencial ativa</span>
              </div>
            ) : (
              <div className="qr-state">
                {qrStatus === "REVOKED"
                  ? "A credencial anterior foi revogada."
                  : "Este funcionário ainda não possui QR Code."}
              </div>
            )}
            {qrError && (
              <div className="form-error" role="alert">
                {qrError}
              </div>
            )}
            <div className="modal-actions qr-actions">
              {qrToken ? (
                <>
                  <button className="secondary-button" onClick={downloadQr}>
                    <Download size={15} />
                    Baixar SVG
                  </button>
                  <button className="secondary-button" onClick={() => window.print()}>
                    <Printer size={15} />
                    Imprimir
                  </button>
                  <button
                    className="danger-button"
                    disabled={qrLoading}
                    onClick={() => void revokeQr()}
                  >
                    Revogar
                  </button>
                </>
              ) : (
                <button
                  className="primary-button"
                  disabled={qrLoading || qrStatus === null || qrEmployee.status !== "ACTIVE"}
                  onClick={() => void issueQr()}
                >
                  {qrLoading
                    ? "Aguarde..."
                    : qrStatus === "REVOKED"
                      ? "Gerar nova credencial"
                      : "Gerar QR Code"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

function todayDateKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function saoPauloDateKeyForBrowser(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toSaoPauloDateTimeLocal(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function saoPauloDateTimeToIso(value: string): string {
  const [date, time] = value.split("T");
  const [year, month, day] = date!.split("-").map(Number);
  const [hour, minute] = time!.split(":").map(Number);
  const wallTime = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const offsetInstant = new Date(wallTime - 3 * 60 * 60 * 1000);
  const offsetParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(offsetInstant)
      .map((part) => [part.type, part.value])
  );
  const representedAsUtc = Date.UTC(
    Number(offsetParts.year),
    Number(offsetParts.month) - 1,
    Number(offsetParts.day),
    Number(offsetParts.hour),
    Number(offsetParts.minute),
    Number(offsetParts.second)
  );
  const offset = representedAsUtc - Math.floor(offsetInstant.getTime() / 1000) * 1000;
  return new Date(wallTime - offset).toISOString();
}

function formatDateKey(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short"
  }).format(new Date(`${date}T12:00:00-03:00`));
}

function defaultScheduleDay(dayOfWeek: number): ScheduleDay {
  const isWorkday = dayOfWeek <= 5;
  return {
    dayOfWeek,
    startTime: isWorkday ? "08:00" : null,
    breakStartTime: isWorkday ? "12:00" : null,
    breakEndTime: isWorkday ? "13:00" : null,
    endTime: isWorkday ? "17:00" : null
  };
}

function attendanceStatus(status: string, pendingRequest: boolean, waivedMinutes: number): string {
  if (pendingRequest) return "Solicitação pendente";
  if (waivedMinutes > 0) return "Abono aplicado";
  if (status === "REST") return "Folga";
  if (status === "UPCOMING") return "Não iniciada";
  if (status === "IN_PROGRESS") return "Em andamento";
  if (status === "ABSENT") return "Sem marcações";
  if (status === "INCOMPLETE") return "Ponto incompleto";
  return "Conferido";
}
