import { Html5Qrcode } from "html5-qrcode";
import {
  Camera,
  CheckCircle2,
  CircleAlert,
  LockKeyhole,
  Moon,
  RefreshCw,
  Sandwich,
  Sun
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const terminalTokenKey = "ponto-pan.terminal-token";
const timeZone = "America/Sao_Paulo";

type PunchChoice = { eventType: string; label: string };
type PunchFeedback = {
  kind: "success" | "duplicate" | "error" | "confirm";
  title: string;
  detail: string;
  employeeName?: string;
  eventType?: string;
  recordedAt?: string;
  choices?: PunchChoice[];
};
type PendingScan = {
  qrToken: string;
  idempotencyKey: string;
  employeeName?: string;
  choices?: PunchChoice[];
  eventType?: string;
};

const eventLabels: Record<string, string> = {
  ENTRY: "Entrada",
  BREAK_START: "Saída para intervalo",
  BREAK_END: "Retorno do intervalo",
  EXIT: "Saída final"
};

export default function Terminal({
  theme,
  onToggleTheme
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const [terminalKey, setTerminalKey] = useState(
    () => localStorage.getItem(terminalTokenKey) ?? ""
  );
  const [terminalName, setTerminalName] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [setupError, setSetupError] = useState("");
  const [savingSetup, setSavingSetup] = useState(false);
  const [feedback, setFeedback] = useState<PunchFeedback | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [cameraState, setCameraState] = useState("Iniciando câmera...");
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const previewPunchRef = useRef<() => Promise<void>>(async () => {});
  const processingRef = useRef(false);
  const pendingRef = useRef<PendingScan | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!terminalKey || terminalName) return;
    let disposed = false;
    void terminalFetch<{ id: string; name: string }>("/me", terminalKey)
      .then((terminal) => {
        if (!disposed) setTerminalName(terminal.name);
      })
      .catch(() => {
        if (disposed) return;
        localStorage.removeItem(terminalTokenKey);
        setTerminalKey("");
        setSetupError("A credencial deste terminal foi revogada ou é inválida.");
      });
    return () => {
      disposed = true;
    };
  }, [terminalKey, terminalName]);

  useEffect(() => {
    if (!terminalKey || !terminalName) return;
    const scanner = new Html5Qrcode("punch-qr-reader", false);
    scannerRef.current = scanner;
    let disposed = false;

    void scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
        (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          scanner.pause(true);
          setFeedback(null);
          pendingRef.current = { qrToken: decodedText, idempotencyKey: crypto.randomUUID() };
          void previewPunchRef.current();
        },
        () => undefined
      )
      .then(() => {
        if (disposed) {
          return scanner.stop();
        }
        setCameraState("Câmera pronta para leitura");
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setCameraError(cameraMessage(error));
          setCameraState("Câmera indisponível");
        }
      });

    return () => {
      disposed = true;
      scannerRef.current = null;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (scanner.isScanning) void scanner.stop().catch(() => undefined);
    };
  }, [terminalKey, terminalName]);

  async function configureTerminal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupError("");
    setSavingSetup(true);
    const key = setupKey.trim();
    try {
      const response = await terminalFetch<{ id: string; name: string }>("/me", key);
      localStorage.setItem(terminalTokenKey, key);
      setTerminalKey(key);
      setTerminalName(response.name);
    } catch (cause) {
      setSetupError(
        cause instanceof Error ? cause.message : "Não foi possível configurar este terminal."
      );
    } finally {
      setSavingSetup(false);
    }
  }

  async function submitPunch(eventType?: string) {
    const current = pendingRef.current;
    if (!current) return;
    setBusy(true);
    try {
      const response = await fetch("/api/terminal/punch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Terminal-Key": terminalKey
        },
        body: JSON.stringify({
          qrToken: current.qrToken,
          idempotencyKey: current.idempotencyKey,
          eventType: eventType ?? current.eventType
        })
      });
      const result: unknown = await response.json().catch(() => null);
      if (response.status === 409 && isSelectionResponse(result)) {
        pendingRef.current = {
          ...current,
          eventType: undefined,
          choices: result.choices
        };
        setFeedback({
          kind: "confirm",
          title: `Olá, ${current.employeeName ?? "funcionário"}!`,
          detail: "A sequência mudou. Escolha a marcação e confirme para registrar.",
          employeeName: current.employeeName,
          choices: result.choices
        });
        return;
      }
      if (!response.ok) {
        throw new TerminalRequestError(
          readError(result) ?? "Não foi possível confirmar o registro.",
          response.status >= 500,
          response.status
        );
      }
      if (!isPunchResponse(result)) {
        throw new Error("O servidor não retornou a confirmação do registro.");
      }
      pendingRef.current = null;
      setFeedback({
        kind: result.status === "DUPLICATE" ? "duplicate" : "success",
        title:
          result.status === "DUPLICATE"
            ? "Leitura já registrada"
            : `Ponto registrado, ${result.employeeName}!`,
        detail:
          result.status === "DUPLICATE"
            ? "Este QR já foi processado. Nenhum registro adicional foi criado."
            : (eventLabels[result.eventType] ?? "Registro confirmado"),
        employeeName: result.employeeName,
        eventType: result.eventType,
        recordedAt: result.recordedAt
      });
      resumeAfterConfirmation();
    } catch (cause) {
      if (cause instanceof TerminalRequestError && cause.status === 401) {
        localStorage.removeItem(terminalTokenKey);
        setTerminalKey("");
        setTerminalName("");
        setSetupError("A credencial foi revogada. Solicite uma nova ao administrador.");
        return;
      }
      setFeedback({
        kind: "error",
        title: "Registro não confirmado",
        detail: cause instanceof Error ? cause.message : "Falha de conexão. Tente novamente."
      });
      if (cause instanceof TerminalRequestError && !cause.retryable) {
        pendingRef.current = null;
        resumeAfterConfirmation();
      }
    } finally {
      setBusy(false);
    }
  }
  async function previewPunch() {
    const current = pendingRef.current;
    if (!current) return;
    setBusy(true);
    try {
      const response = await fetch("/api/terminal/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Terminal-Key": terminalKey
        },
        body: JSON.stringify({ qrToken: current.qrToken })
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(result) ?? "Não foi possível identificar o QR Code.");
      }
      if (!isPreviewResponse(result)) {
        throw new Error("O servidor não retornou os dados do funcionário.");
      }
      const eventType = result.choices.length === 1 ? result.choices[0]?.eventType : undefined;
      pendingRef.current = {
        ...current,
        employeeName: result.employeeName,
        choices: result.choices,
        eventType
      };
      setFeedback({
        kind: "confirm",
        title: `Olá, ${result.employeeName}!`,
        detail: eventType
          ? `Deseja registrar ${eventLabels[eventType]?.toLowerCase() ?? "seu ponto"} agora?`
          : "O que deseja registrar? Escolha a marcação e confirme.",
        employeeName: result.employeeName,
        eventType,
        choices: result.choices
      });
    } catch (cause) {
      pendingRef.current = null;
      setFeedback({
        kind: "error",
        title: "Não foi possível identificar",
        detail: cause instanceof Error ? cause.message : "Falha ao consultar o servidor."
      });
      resumeAfterConfirmation();
    } finally {
      setBusy(false);
    }
  }
  previewPunchRef.current = previewPunch;

  function chooseEvent(choice: PunchChoice) {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = { ...current, eventType: choice.eventType };
    setFeedback({
      kind: "confirm",
      title: `Olá, ${current.employeeName ?? "funcionário"}!`,
      detail: `Deseja registrar ${choice.label.toLowerCase()} agora?`,
      employeeName: current.employeeName,
      eventType: choice.eventType,
      choices: current.choices
    });
  }

  function cancelReview() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    processingRef.current = false;
    setFeedback(null);
    scannerRef.current?.resume();
  }

  async function retryScan() {
    if (!pendingRef.current) return;
    setFeedback(null);
    await submitPunch(pendingRef.current.eventType);
  }

  function resumeAfterConfirmation() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setFeedback(null);
      pendingRef.current = null;
      processingRef.current = false;
      try {
        scannerRef.current?.resume();
      } catch {
        setCameraError("Não foi possível reiniciar a câmera. Recarregue esta tela.");
      }
    }, 4000);
  }

  function disconnectTerminal() {
    if (!window.confirm("Desconectar este terminal deste navegador?")) return;
    localStorage.removeItem(terminalTokenKey);
    setTerminalKey("");
    setTerminalName("");
    setFeedback(null);
    pendingRef.current = null;
    processingRef.current = false;
  }

  if (!terminalKey) {
    return (
      <main className="terminal-setup-page">
        <section className="terminal-setup-card">
          <div className="terminal-brand">
            <div className="brand-mark">
              <Sandwich size={21} />
            </div>
            <div>
              <strong>VPAN</strong>
              <span>TERMINAL DE PONTO</span>
            </div>
          </div>
          <button
            className="theme-toggle terminal-theme-toggle"
            onClick={onToggleTheme}
            aria-label="Alternar tema"
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>
          </button>
          <div className="terminal-setup-icon">
            <LockKeyhole size={25} />
          </div>
          <h1>Configurar terminal</h1>
          <p>
            Insira a credencial provisionada pelo administrador para autorizar este dispositivo.
          </p>
          <form className="form-stack" onSubmit={configureTerminal}>
            <label>
              Credencial deste terminal
              <input
                autoComplete="off"
                value={setupKey}
                onChange={(event) => setSetupKey(event.target.value)}
                required
                minLength={32}
                maxLength={128}
              />
            </label>
            {setupError && (
              <div className="form-error" role="alert">
                {setupError}
              </div>
            )}
            <button className="primary-button" type="submit" disabled={savingSetup}>
              {savingSetup ? "Verificando..." : "Conectar terminal"}
            </button>
          </form>
          <div className="terminal-setup-foot">
            Esta credencial autoriza somente o registro de ponto neste terminal. Use um dispositivo
            restrito e uma conexão HTTPS.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="terminal-page">
      <header className="terminal-header">
        <div className="terminal-brand">
          <div className="brand-mark">
            <Sandwich size={21} />
          </div>
          <div>
            <strong>VPAN</strong>
            <span>TERMINAL DE PONTO</span>
          </div>
        </div>
        <button
          className="theme-toggle terminal-theme-toggle"
          onClick={onToggleTheme}
          aria-label="Alternar tema"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>
        </button>
        <div className="terminal-clock">
          <span>
            {clock.toLocaleDateString("pt-BR", {
              timeZone,
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric"
            })}
          </span>
          <strong>
            {clock.toLocaleTimeString("pt-BR", {
              timeZone,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })}
          </strong>
        </div>
        <button
          className="terminal-disconnect"
          onClick={disconnectTerminal}
          aria-label="Desconectar terminal"
        >
          <LockKeyhole size={17} />
        </button>
      </header>
      <section className="terminal-content">
        <div className="terminal-heading">
          <span className="eyebrow">REGISTRO DE JORNADA</span>
          <h1>Aproxime seu QR Code</h1>
          <p>Leia seu QR Code, confira a marcação e confirme antes de registrar o ponto.</p>
        </div>
        <div className="terminal-reader-card">
          <div className="terminal-camera-header">
            <span>
              <Camera size={16} /> Leitor de QR Code
            </span>
            <span
              className={`camera-indicator ${cameraError ? "camera-error" : cameraState.includes("pronta") ? "camera-ready" : ""}`}
            >
              <i />
              {cameraState}
            </span>
          </div>
          <div className="terminal-reader-frame">
            <div id="punch-qr-reader" className="qr-reader-target" />
            {feedback && (
              <div
                className={`terminal-feedback ${feedback.kind}`}
                role={feedback.kind === "error" ? "alert" : "status"}
              >
                <div className="feedback-icon">
                  {feedback.kind === "error" ? (
                    <CircleAlert size={23} />
                  ) : (
                    <CheckCircle2 size={23} />
                  )}
                </div>
                <strong>{feedback.title}</strong>
                {feedback.employeeName && (
                  <span className="feedback-name">{feedback.employeeName}</span>
                )}
                <span>{feedback.detail}</span>
                {feedback.recordedAt && (
                  <time>
                    {new Intl.DateTimeFormat("pt-BR", {
                      timeZone,
                      dateStyle: "short",
                      timeStyle: "medium"
                    }).format(new Date(feedback.recordedAt))}
                  </time>
                )}
                {feedback.kind === "confirm" && feedback.choices && (
                  <>
                    {feedback.choices.length > 1 && (
                      <div className="event-choice-list">
                        {feedback.choices.map((choice) => (
                          <button
                            key={choice.eventType}
                            className={feedback.eventType === choice.eventType ? "selected" : ""}
                            disabled={busy}
                            onClick={() => chooseEvent(choice)}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {feedback.choices.length === 1 && (
                      <span className="feedback-event">
                        {eventLabels[feedback.choices[0]!.eventType]}
                      </span>
                    )}
                    <div className="feedback-actions">
                      <button className="secondary-button" disabled={busy} onClick={cancelReview}>
                        Cancelar
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy || !feedback.eventType}
                        onClick={() => void submitPunch(feedback.eventType)}
                      >
                        Confirmar registro
                      </button>
                    </div>
                  </>
                )}
                {feedback.kind === "error" && (
                  <button className="retry-button" disabled={busy} onClick={() => void retryScan()}>
                    <RefreshCw size={15} />
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
          </div>
          <div className={`camera-message ${cameraError ? "camera-message-error" : ""}`}>
            {cameraError ||
              (busy
                ? "Identificando funcionário com segurança..."
                : "Nenhum ponto é registrado sem confirmação do funcionário.")}
          </div>
        </div>
        <div className="terminal-footer">
          <i />
          {terminalName} <span>·</span> Conectado ao servidor
        </div>
        <p className="terminal-security-note">
          O registro só é confirmado após resposta do servidor. O QR Code pode ser copiado e não
          comprova, por si só, a identidade física de quem o apresenta.
        </p>
      </section>
    </main>
  );
}

async function terminalFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`/api/terminal${path}`, {
    headers: { "X-Terminal-Key": token }
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readError(result) ?? "Terminal não autorizado.");
  return result as T;
}

function isSelectionResponse(value: unknown): value is { choices: PunchChoice[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "SELECT_EVENT" &&
    "choices" in value &&
    Array.isArray(value.choices)
  );
}

function isPreviewResponse(value: unknown): value is {
  employeeName: string;
  choices: PunchChoice[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "employeeName" in value &&
    typeof value.employeeName === "string" &&
    "choices" in value &&
    Array.isArray(value.choices) &&
    value.choices.length > 0 &&
    value.choices.every(
      (choice) =>
        typeof choice === "object" &&
        choice !== null &&
        "eventType" in choice &&
        typeof choice.eventType === "string" &&
        "label" in choice &&
        typeof choice.label === "string"
    )
  );
}

function isPunchResponse(value: unknown): value is {
  status: "RECORDED" | "DUPLICATE";
  employeeName: string;
  eventType: string;
  recordedAt: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "RECORDED" || value.status === "DUPLICATE") &&
    "employeeName" in value &&
    typeof value.employeeName === "string" &&
    "eventType" in value &&
    typeof value.eventType === "string" &&
    "recordedAt" in value &&
    typeof value.recordedAt === "string"
  );
}

function readError(value: unknown): string | null {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : null;
}

class TerminalRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number
  ) {
    super(message);
  }
}

function cameraMessage(error: unknown): string {
  if (error instanceof Error && /permission|denied|notallowed/i.test(error.message)) {
    return "Permita o acesso à câmera nas configurações do navegador.";
  }
  return "Não foi possível iniciar a câmera. Verifique o dispositivo e as permissões.";
}
