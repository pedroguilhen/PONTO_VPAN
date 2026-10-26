import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Check, CircleAlert, UserPlus, X } from "lucide-react";
import { apiRequest } from "./api";

type ScopedEmployee = {
  id: string;
  name: string;
  registration: string;
  status: string;
};

type PunchHistory = {
  items: {
    id: string;
    eventType: string;
    recordedAt: string;
    voidedAt: string | null;
  }[];
};

type AttendanceRequest = {
  id: string;
  type: "CORRECT_PUNCH" | "ADD_PUNCH" | "HOUR_WAIVER" | "VOID_PUNCH";
  status: "PENDING" | "APPROVED" | "REJECTED";
  targetEventType: string | null;
  targetRecordedAt: string | null;
  proposedEventType: string | null;
  proposedRecordedAt: string | null;
  targetDate: string | null;
  minutes: number | null;
  reason: string;
  reviewComment: string | null;
  createdAt: string;
  employee: { id: string; name: string; registration: string };
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  targetEvent: { id: string; eventType: string; recordedAt: string } | null;
  resultEvent: { id: string; eventType: string; recordedAt: string } | null;
};

type Manager = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  employeeScopes: { employee: ScopedEmployee }[];
};

const eventLabels: Record<string, string> = {
  ENTRY: "Entrada",
  BREAK_START: "Saída para intervalo",
  BREAK_END: "Retorno do intervalo",
  EXIT: "Saída final"
};

const requestLabels: Record<AttendanceRequest["type"], string> = {
  CORRECT_PUNCH: "Correção de marcação",
  ADD_PUNCH: "Inclusão de ponto esquecido",
  HOUR_WAIVER: "Abono de horas",
  VOID_PUNCH: "Descarte de marcação incorreta"
};

export function ManagerTeam() {
  const [employees, setEmployees] = useState<ScopedEmployee[]>([]);
  const [error, setError] = useState("");
  const [showRequest, setShowRequest] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [requestType, setRequestType] = useState<AttendanceRequest["type"]>("ADD_PUNCH");
  const [punches, setPunches] = useState<PunchHistory["items"]>([]);
  const [loadingPunches, setLoadingPunches] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      const response = await apiRequest<{ items: ScopedEmployee[] }>("/employees/scope");
      setEmployees(response.items.filter((employee) => employee.status === "ACTIVE"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar sua equipe.");
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (!employeeId || (requestType !== "CORRECT_PUNCH" && requestType !== "VOID_PUNCH")) {
      setPunches([]);
      return;
    }
    let disposed = false;
    setLoadingPunches(true);
    void apiRequest<PunchHistory>(`/employees/${employeeId}/punches?limit=100`)
      .then((response) => {
        if (!disposed) setPunches(response.items.filter((punch) => !punch.voidedAt));
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "Falha ao carregar pontos.");
      })
      .finally(() => {
        if (!disposed) setLoadingPunches(false);
      });
    return () => {
      disposed = true;
    };
  }, [employeeId, requestType]);

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | number> = {
      employeeId,
      type: requestType,
      reason: String(form.get("reason") ?? "")
    };
    if (requestType === "HOUR_WAIVER") {
      body.targetDate = String(form.get("targetDate") ?? "");
      body.minutes = Number(form.get("minutes"));
    } else if (requestType === "VOID_PUNCH") {
      body.targetEventId = String(form.get("targetEventId") ?? "");
    } else {
      body.eventType = String(form.get("eventType") ?? "");
      body.recordedAt = new Date(String(form.get("recordedAt"))).toISOString();
      if (requestType === "CORRECT_PUNCH") {
        body.targetEventId = String(form.get("targetEventId") ?? "");
      }
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest("/attendance-requests", { method: "POST", body: JSON.stringify(body) });
      setShowRequest(false);
      setEmployeeId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao enviar solicitação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EQUIPE VINCULADA</span>
          <h1>Minha equipe</h1>
          <p>Solicite correções e abonos para análise do administrador.</p>
        </div>
        <button
          className="primary-button compact"
          disabled={employees.length === 0}
          onClick={() => setShowRequest(true)}
        >
          <UserPlus size={15} /> Nova solicitação
        </button>
      </div>
      {error && (
        <p className="form-error inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-panel">
        <div className="table-toolbar">
          <strong className="panel-title">Funcionários sob sua gestão</strong>
          <span className="result-count">{employees.length} vinculados</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>FUNCIONÁRIO</th>
                <th>MATRÍCULA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.length ? (
                employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="employee-name">{employee.name}</td>
                    <td>{employee.registration}</td>
                    <td>
                      <NavLink className="qr-action" to={`/funcionarios/${employee.id}`}>
                        Ver espelho
                      </NavLink>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="table-empty">
                    Nenhum funcionário foi vinculado a este gestor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showRequest && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
          >
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setShowRequest(false)}
            >
              ×
            </button>
            <span className="eyebrow">ANÁLISE DO ADMINISTRADOR</span>
            <h2 id="request-title">Solicitar ajuste</h2>
            <p>Nenhuma alteração será aplicada antes da aprovação.</p>
            <form className="form-stack" onSubmit={(event) => void submitRequest(event)}>
              <label>
                Funcionário
                <select
                  required
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} · {employee.registration}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de solicitação
                <select
                  value={requestType}
                  onChange={(event) =>
                    setRequestType(event.target.value as AttendanceRequest["type"])
                  }
                >
                  <option value="ADD_PUNCH">Incluir ponto esquecido</option>
                  <option value="CORRECT_PUNCH">Corrigir ponto existente</option>
                  <option value="HOUR_WAIVER">Abonar horas faltantes</option>
                  <option value="VOID_PUNCH">Descartar marcação incorreta</option>
                </select>
              </label>
              {(requestType === "CORRECT_PUNCH" || requestType === "VOID_PUNCH") && (
                <label>
                  Ponto original
                  <select name="targetEventId" required disabled={!employeeId || loadingPunches}>
                    <option value="">
                      {loadingPunches ? "Carregando..." : "Selecione o ponto"}
                    </option>
                    {punches.map((punch) => (
                      <option value={punch.id} key={punch.id}>
                        {eventLabels[punch.eventType] ?? punch.eventType} ·{" "}
                        {formatDateTime(punch.recordedAt)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {requestType === "HOUR_WAIVER" ? (
                <>
                  <label>
                    Dia
                    <input
                      name="targetDate"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      required
                    />
                  </label>
                  <label>
                    Horas a abonar (minutos)
                    <input name="minutes" type="number" min={1} max={1440} required />
                  </label>
                </>
              ) : requestType !== "VOID_PUNCH" ? (
                <>
                  <label>
                    Tipo de ponto
                    <select name="eventType" required>
                      {Object.entries(eventLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Data e hora proposta
                    <input
                      name="recordedAt"
                      type="datetime-local"
                      max={toDateTimeLocal(new Date())}
                      required
                    />
                  </label>
                </>
              ) : (
                <p>A marcação só será descartada após aprovação administrativa.</p>
              )}
              <label>
                Justificativa (obrigatória)
                <textarea name="reason" minLength={10} maxLength={500} required rows={3} />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowRequest(false)}
                >
                  Cancelar
                </button>
                <button className="primary-button" disabled={saving || !employeeId}>
                  {saving ? "Enviando..." : "Enviar para aprovação"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export function AttendanceRequests({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<AttendanceRequest[]>([]);
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "ALL">("PENDING");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = status === "ALL" ? "" : `?status=${status}`;
      const response = await apiRequest<{ items: AttendanceRequest[] }>(
        `/attendance-requests${query}`
      );
      setItems(response.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar solicitações.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function decide(item: AttendanceRequest, decision: "APPROVE" | "REJECT") {
    if (!comments[item.id]?.trim()) {
      setError("Informe o motivo da análise antes de concluir.");
      return;
    }
    setBusyId(item.id);
    setError("");
    try {
      await apiRequest(`/attendance-requests/${item.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewComment: comments[item.id] ?? "" })
      });
      await loadRequests();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao analisar solicitação.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{isAdmin ? "FILA DE APROVAÇÃO" : "ACOMPANHAMENTO"}</span>
          <h1>Solicitações</h1>
          <p>
            {isAdmin
              ? "Aprovações aplicam correções e abonos ao espelho."
              : "Acompanhe a análise dos pedidos enviados."}
          </p>
        </div>
        <label className="filter-select">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="PENDING">Pendentes</option>
            <option value="APPROVED">Aprovadas</option>
            <option value="REJECTED">Rejeitadas</option>
            <option value="ALL">Todas</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="form-error inline-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="empty-dashboard">Carregando solicitações...</div>
      ) : items.length ? (
        <div className="request-list">
          {items.map((item) => (
            <article className={`request-card ${item.status.toLowerCase()}`} key={item.id}>
              <div className="request-card-header">
                <div>
                  <span
                    className={`status-pill ${item.status === "APPROVED" ? "active" : item.status === "PENDING" ? "pending" : "inactive"}`}
                  >
                    {statusLabel(item.status)}
                  </span>
                  <h2>
                    {requestLabels[item.type]} · {item.employee.name}
                  </h2>
                  <p>
                    Matrícula {item.employee.registration} · solicitado por {item.requestedBy.name}{" "}
                    · {formatDateTime(item.createdAt)}
                  </p>
                </div>
                {item.status === "PENDING" && isAdmin && (
                  <CircleAlert size={19} className="request-pending-icon" />
                )}
              </div>
              <div className="request-detail-grid">
                <div>
                  <span>JUSTIFICATIVA</span>
                  <p>{item.reason}</p>
                </div>
                {item.type === "HOUR_WAIVER" ? (
                  <div>
                    <span>ABONO SOLICITADO</span>
                    <p>
                      {item.minutes ?? 0} min · {formatDate(item.targetDate)}
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <span>MARCAÇÃO ANTERIOR</span>
                      <p>
                        {item.targetEventType && item.targetRecordedAt
                          ? `${eventLabels[item.targetEventType] ?? item.targetEventType} · ${formatDateTime(item.targetRecordedAt)}`
                          : "Não havia marcação"}
                      </p>
                    </div>
                    <div>
                      <span>MARCAÇÃO PROPOSTA</span>
                      <p>
                        {item.type === "VOID_PUNCH"
                          ? "Descartar esta marcação (histórico preservado)"
                          : `${eventLabels[item.proposedEventType ?? ""] ?? item.proposedEventType} · ${item.proposedRecordedAt ? formatDateTime(item.proposedRecordedAt) : "—"}`}
                      </p>
                    </div>
                  </>
                )}
                {item.reviewComment && (
                  <div>
                    <span>ANÁLISE</span>
                    <p>{item.reviewComment}</p>
                  </div>
                )}
              </div>
              {item.status === "PENDING" && isAdmin && (
                <div className="request-review">
                  <label>
                    Motivo da análise (obrigatório)
                    <textarea
                      rows={2}
                      value={comments[item.id] ?? ""}
                      onChange={(event) =>
                        setComments({ ...comments, [item.id]: event.target.value })
                      }
                      placeholder="Explique a decisão de aprovar ou rejeitar"
                    />
                  </label>
                  <div className="request-actions">
                    <button
                      className="danger-button"
                      disabled={busyId === item.id || !comments[item.id]?.trim()}
                      onClick={() => void decide(item, "REJECT")}
                    >
                      <X size={15} /> Rejeitar
                    </button>
                    <button
                      className="primary-button"
                      disabled={busyId === item.id || !comments[item.id]?.trim()}
                      onClick={() => void decide(item, "APPROVE")}
                    >
                      <Check size={15} /> Aprovar e aplicar
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-dashboard">
          <h2>Nenhuma solicitação encontrada</h2>
          <p>Novos pedidos de correção e abono aparecerão aqui.</p>
        </div>
      )}
    </section>
  );
}

export function Managers() {
  const [items, setItems] = useState<Manager[]>([]);
  const [employees, setEmployees] = useState<ScopedEmployee[]>([]);
  const [editing, setEditing] = useState<Manager | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [managers, available] = await Promise.all([
        apiRequest<{ items: Manager[] }>("/users"),
        apiRequest<{ items: ScopedEmployee[] }>("/employees/scope")
      ]);
      setItems(managers.items);
      setEmployees(available.items.filter((employee) => employee.status === "ACTIVE"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar gestores.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setShowEditor(true);
    setSelectedIds([]);
    setError("");
  }

  function openEdit(manager: Manager) {
    setEditing(manager);
    setShowEditor(true);
    setSelectedIds(manager.employeeScopes.map((scope) => scope.employee.id));
    setError("");
  }

  function toggleEmployee(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await apiRequest(`/users/${editing.id}/scopes`, {
          method: "PUT",
          body: JSON.stringify({ employeeIds: selectedIds })
        });
      } else {
        await apiRequest("/users", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
            employeeIds: selectedIds
          })
        });
      }
      setEditing(null);
      setShowEditor(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar gestor.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(manager: Manager) {
    if (!window.confirm(`Desativar o acesso de ${manager.name}?`)) return;
    try {
      await apiRequest(`/users/${manager.id}/deactivate`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao desativar gestor.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACESSO E ESCOPO</span>
          <h1>Gestores</h1>
          <p>Crie acessos e defina quais funcionários cada gestor pode acompanhar.</p>
        </div>
        <button className="primary-button compact" onClick={openCreate}>
          Cadastrar gestor
        </button>
      </div>
      {error && (
        <p className="form-error inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-panel">
        <div className="table-toolbar">
          <strong className="panel-title">Gestores cadastrados</strong>
          <span className="result-count">{items.length} contas</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>GESTOR</th>
                <th>FUNCIONÁRIOS VINCULADOS</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((manager) => (
                  <tr key={manager.id}>
                    <td>
                      <span className="employee-name">{manager.name}</span>
                      <small className="table-secondary">{manager.email}</small>
                    </td>
                    <td>
                      {manager.employeeScopes.map((scope) => scope.employee.name).join(", ") ||
                        "Nenhum"}
                    </td>
                    <td>
                      <span className={`status-pill ${manager.active ? "active" : "inactive"}`}>
                        {manager.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td>
                      <button className="qr-action" onClick={() => openEdit(manager)}>
                        Editar escopo
                      </button>
                      {manager.active && (
                        <button
                          className="revoke-terminal"
                          onClick={() => void deactivate(manager)}
                        >
                          Desativar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="table-empty">
                    Nenhum gestor cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showEditor && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowEditor(false);
          }}
        >
          <section
            className="modal manager-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-title"
          >
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setShowEditor(false)}
            >
              ×
            </button>
            <span className="eyebrow">{editing ? "GESTÃO DE ESCOPO" : "NOVO ACESSO"}</span>
            <h2 id="manager-title">
              {editing ? `Funcionários de ${editing.name}` : "Cadastrar gestor"}
            </h2>
            <form className="form-stack" onSubmit={(event) => void save(event)}>
              {!editing && (
                <>
                  <label>
                    Nome completo
                    <input name="name" required minLength={2} maxLength={160} />
                  </label>
                  <label>
                    E-mail
                    <input name="email" type="email" required maxLength={254} />
                  </label>
                  <label>
                    Senha inicial
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      maxLength={72}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              )}
              <fieldset className="employee-scope-list">
                <legend>Funcionários que este gestor poderá visualizar</legend>
                {employees.map((employee) => (
                  <label key={employee.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(employee.id)}
                      onChange={() => toggleEmployee(employee.id)}
                    />
                    <span>
                      {employee.name} · {employee.registration}
                    </span>
                  </label>
                ))}
              </fieldset>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowEditor(false)}
                >
                  Cancelar
                </button>
                <button className="primary-button" disabled={saving || selectedIds.length === 0}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
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

function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short"
      }).format(new Date(value))
    : "—";
}

function toDateTimeLocal(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function statusLabel(status: AttendanceRequest["status"]): string {
  if (status === "APPROVED") return "Aprovada";
  if (status === "REJECTED") return "Rejeitada";
  return "Pendente";
}
