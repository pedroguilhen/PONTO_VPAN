import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { apiRequest } from "./api";

type TerminalRecord = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

export default function Terminals() {
  const [terminals, setTerminals] = useState<TerminalRecord[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; token: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  const loadTerminals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setTerminals(await apiRequest<TerminalRecord[]>("/terminals"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar os terminais.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTerminals();
  }, [loadTerminals]);

  async function createTerminal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest<{ id: string; name: string; token: string }>("/terminals", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      setCreated(result);
      setName("");
      await loadTerminals();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao provisionar o terminal.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeTerminal(terminal: TerminalRecord) {
    if (!window.confirm(`Revogar o acesso do terminal "${terminal.name}"?`)) return;
    setError("");
    try {
      await apiRequest(`/terminals/${terminal.id}/revoke`, { method: "POST" });
      await loadTerminals();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao revogar o terminal.");
    }
  }

  async function copyCredential() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopyMessage("Credencial copiada. Salve-a agora; ela não poderá ser exibida novamente.");
    } catch {
      setCopyMessage("Não foi possível copiar automaticamente. Selecione e copie a credencial.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DISPOSITIVOS AUTORIZADOS</span>
          <h1>Terminais de ponto</h1>
          <p>Provisione um acesso individual e revogável para cada dispositivo fixo.</p>
        </div>
        <a
          className="secondary-button terminal-open-link"
          href="/terminal"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={15} /> Abrir terminal
        </a>
      </div>
      <div className="terminal-provision-panel">
        <div>
          <strong>Conectar um novo dispositivo</strong>
          <p>
            A credencial só é exibida uma vez. Configure o terminal imediatamente e mantenha o
            dispositivo protegido.
          </p>
        </div>
        <form className="terminal-provision-form" onSubmit={createTerminal}>
          <input
            aria-label="Nome do terminal"
            placeholder="Ex.: Recepção"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
          <button className="primary-button" disabled={saving}>
            {saving ? "Provisionando..." : "Provisionar terminal"}
          </button>
        </form>
      </div>
      {error && (
        <p className="form-error inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-panel terminal-table-panel">
        <div className="table-toolbar">
          <strong className="panel-title">Terminais cadastrados</strong>
          <span className="result-count">{terminals.length} dispositivos</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>NOME</th>
                <th>CRIADO EM</th>
                <th>ÚLTIMA ATIVIDADE</th>
                <th>SITUAÇÃO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Carregando terminais...
                  </td>
                </tr>
              ) : terminals.length ? (
                terminals.map((terminal) => (
                  <tr key={terminal.id}>
                    <td>
                      <span className="employee-name">{terminal.name}</span>
                    </td>
                    <td>{formatDate(terminal.createdAt)}</td>
                    <td>
                      {terminal.lastSeenAt
                        ? formatDate(terminal.lastSeenAt)
                        : "Ainda não conectado"}
                    </td>
                    <td>
                      <span className={`status-pill ${terminal.active ? "active" : "inactive"}`}>
                        {terminal.active ? "Ativo" : "Revogado"}
                      </span>
                    </td>
                    <td>
                      {terminal.active && (
                        <button
                          className="revoke-terminal"
                          onClick={() => void revokeTerminal(terminal)}
                        >
                          Revogar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Nenhum terminal provisionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {created && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal terminal-credential-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terminal-credential-title"
          >
            <span className="eyebrow">CREDENCIAL EXIBIDA UMA ÚNICA VEZ</span>
            <h2 id="terminal-credential-title">Terminal “{created.name}” provisionado</h2>
            <p>
              Copie e configure no dispositivo agora. Fechar esta janela apaga a credencial desta
              sessão; se perdê-la, revogue o terminal e provisione outro.
            </p>
            <label className="credential-label">
              Credencial do terminal
              <input
                readOnly
                value={created.token}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <button
              className="secondary-button copy-credential"
              onClick={() => void copyCredential()}
            >
              <Copy size={15} /> Copiar credencial
            </button>
            {copyMessage && (
              <p className="success-message credential-copy-message" role="status">
                {copyMessage}
              </p>
            )}
            <div className="terminal-setup-link">
              <span>Abra no dispositivo:</span>
              <code>{window.location.origin}/terminal</code>
            </div>
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => {
                  setCreated(null);
                  setCopyMessage("");
                }}
              >
                Concluído
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
