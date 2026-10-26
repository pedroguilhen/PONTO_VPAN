import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { saoPauloDateKey, saoPauloInstant } from "./attendance-calculations.js";
import { prisma } from "./db.js";
import { hashQrToken } from "./qr-token.js";

const password = "senha-de-teste-com-mais-de-12";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const adminEmail = `admin-${suffix}@example.test`;
const managerEmail = `manager-${suffix}@example.test`;
const registration = `TEST-${suffix}`;
const appPromise = buildApp();
let adminId = "";
let managerId = "";
let employeeId = "";
let terminalId = "";

describe("administrative API", () => {
  beforeAll(async () => {
    await appPromise;
    const passwordHash = await hash(password, 12);
    const [admin, manager] = await Promise.all([
      prisma.user.create({
        data: { email: adminEmail, name: "Admin de teste", passwordHash, role: "ADMIN" }
      }),
      prisma.user.create({
        data: { email: managerEmail, name: "Gestor de teste", passwordHash, role: "MANAGER" }
      })
    ]);
    adminId = admin.id;
    managerId = manager.id;
  });

  afterAll(async () => {
    if (employeeId) {
      await prisma.attendanceRequest.deleteMany({ where: { employeeId } });
      await prisma.punchEvent.deleteMany({ where: { employeeId } });
      await prisma.qrCredential.deleteMany({ where: { employeeId } });
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
    if (terminalId) {
      await prisma.punchTerminal.deleteMany({ where: { id: terminalId } });
    }
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, managerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, managerId] } } });
    await (await appPromise).close();
  });

  it("reports health only when the database is reachable", async () => {
    const response = await (await appPromise).inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rejects unauthenticated employee queries", async () => {
    const response = await (
      await appPromise
    ).inject({
      method: "GET",
      url: "/api/employees"
    });
    expect(response.statusCode).toBe(401);
    const terminalResponse = await (
      await appPromise
    ).inject({
      method: "GET",
      url: "/api/terminal/me"
    });
    expect(terminalResponse.statusCode).toBe(401);
  });

  it("authenticates an administrator and normalizes email case", async () => {
    const response = await (
      await appPromise
    ).inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: adminEmail.toUpperCase(), password }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(adminEmail);
    expect(response.json().accessToken).toEqual(expect.any(String));
  });

  it("does not allow a manager to use administrator-only employee routes", async () => {
    const app = await appPromise;
    const login = {
      json: () => ({
        accessToken: app.jwt.sign({ sub: managerId, email: managerEmail, role: "MANAGER" })
      })
    };
    const response = await app.inject({
      method: "GET",
      url: "/api/employees",
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it("invalidates an access token immediately after user deactivation", async () => {
    const app = await appPromise;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: adminEmail, password }
    });
    await prisma.user.update({ where: { id: adminId }, data: { active: false } });
    const response = await app.inject({
      method: "GET",
      url: "/api/employees",
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    await prisma.user.update({ where: { id: adminId }, data: { active: true } });
    expect(response.statusCode).toBe(401);
  });

  it("creates an employee and an audit entry without creating a user account", async () => {
    const app = await appPromise;
    const login = {
      json: () => ({
        accessToken: app.jwt.sign({ sub: adminId, email: adminEmail, role: "ADMIN" })
      })
    };
    const authorization = `Bearer ${login.json().accessToken}`;
    const usersBefore = await prisma.user.count();
    const response = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers: { authorization },
      payload: { registration, name: "Funcionário de teste" }
    });

    expect(response.statusCode).toBe(201);
    const employee = response.json();
    employeeId = employee.id as string;
    expect(employee.registration).toBe(registration);
    const defaultSchedule = await prisma.workSchedule.findFirst({
      where: { employeeId },
      include: { days: { orderBy: { dayOfWeek: "asc" } } }
    });
    expect(defaultSchedule?.days[0]).toMatchObject({
      dayOfWeek: 1,
      startTime: "08:00",
      breakStartTime: "12:00",
      breakEndTime: "13:00",
      endTime: "17:00"
    });
    expect(defaultSchedule?.days[5]).toMatchObject({
      dayOfWeek: 6,
      startTime: null,
      endTime: null
    });
    const nextDate = saoPauloDateKey(new Date(Date.now() + 30 * 60 * 60 * 1000));
    const scheduleDays = Array.from({ length: 7 }, (_, index) => {
      const dayOfWeek = index + 1;
      const workday = dayOfWeek <= 5;
      return {
        dayOfWeek,
        startTime: workday ? "09:00" : null,
        breakStartTime: workday ? "12:00" : null,
        breakEndTime: workday ? "13:00" : null,
        endTime: workday ? "18:00" : null
      };
    });
    const scheduleUpdate = await app.inject({
      method: "POST",
      url: `/api/employees/${employee.id}/schedules`,
      headers: { authorization },
      payload: { effectiveFrom: nextDate, days: scheduleDays }
    });
    expect(scheduleUpdate.statusCode).toBe(201);
    expect(scheduleUpdate.json().days[0].startTime).toBe("09:00");
    const duplicateSchedule = await app.inject({
      method: "POST",
      url: `/api/employees/${employee.id}/schedules`,
      headers: { authorization },
      payload: { effectiveFrom: nextDate, days: scheduleDays }
    });
    expect(duplicateSchedule.statusCode).toBe(409);
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(
      await prisma.auditLog.count({
        where: { actorId: adminId, entityType: "Employee", entityId: employee.id }
      })
    ).toBe(1);
    const overview = await app.inject({
      method: "GET",
      url: "/api/employees/overview",
      headers: { authorization }
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().activeEmployees).toBeGreaterThanOrEqual(1);

    const qrPath = `/api/employees/${employee.id}/qr`;
    const issued = await app.inject({
      method: "POST",
      url: qrPath,
      headers: { authorization }
    });
    expect(issued.statusCode).toBe(201);
    const token = issued.json().token as string;
    const credential = await prisma.qrCredential.findFirst({ where: { employeeId: employee.id } });
    expect(credential?.tokenHash).toBe(hashQrToken(token));
    expect(credential?.encryptedToken).not.toContain(token);

    const viewed = await app.inject({
      method: "GET",
      url: qrPath,
      headers: { authorization }
    });
    expect(viewed.json()).toEqual({ status: "ACTIVE", token });

    const duplicateQr = await app.inject({
      method: "POST",
      url: qrPath,
      headers: { authorization }
    });
    expect(duplicateQr.statusCode).toBe(409);

    const revoked = await app.inject({
      method: "POST",
      url: `${qrPath}/revoke`,
      headers: { authorization }
    });
    expect(revoked.json()).toEqual({ status: "REVOKED" });
    const viewedRevoked = await app.inject({
      method: "GET",
      url: qrPath,
      headers: { authorization }
    });
    expect(viewedRevoked.json()).toEqual({ status: "REVOKED" });

    const reissued = await app.inject({
      method: "POST",
      url: qrPath,
      headers: { authorization }
    });
    expect(reissued.statusCode).toBe(201);
    expect(reissued.json().token).not.toBe(token);

    const provisioned = await app.inject({
      method: "POST",
      url: "/api/terminals",
      headers: { authorization },
      payload: { name: "Terminal de teste" }
    });
    expect(provisioned.statusCode).toBe(201);
    const terminalToken = provisioned.json().token as string;
    terminalId = provisioned.json().id as string;
    const terminalHeaders = { "x-terminal-key": terminalToken };

    const terminalInfo = await app.inject({
      method: "GET",
      url: "/api/terminal/me",
      headers: terminalHeaders
    });
    expect(terminalInfo.statusCode).toBe(200);
    expect(terminalInfo.json().name).toBe("Terminal de teste");

    const previewPunchCount = await prisma.punchEvent.count({ where: { employeeId } });
    const preview = await app.inject({
      method: "POST",
      url: "/api/terminal/preview",
      headers: terminalHeaders,
      payload: { qrToken: reissued.json().token }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().employeeName).toBe("Funcionário de teste");
    expect(preview.json().choices).toEqual([{ eventType: "ENTRY", label: "Entrada" }]);
    expect(await prisma.punchEvent.count({ where: { employeeId } })).toBe(previewPunchCount);

    const mark = (idempotencyKey: string, eventType?: string) =>
      app.inject({
        method: "POST",
        url: "/api/terminal/punch",
        headers: terminalHeaders,
        payload: {
          qrToken: reissued.json().token,
          idempotencyKey,
          ...(eventType ? { eventType } : {})
        }
      });

    const entryKey = crypto.randomUUID();
    const entry = await mark(entryKey);
    expect(entry.statusCode).toBe(200);
    expect(entry.json().eventType).toBe("ENTRY");
    expect(entry.json().status).toBe("RECORDED");
    const retry = await mark(entryKey);
    expect(retry.json().status).toBe("DUPLICATE");
    const repeatedRead = await mark(crypto.randomUUID());
    expect(repeatedRead.json().status).toBe("DUPLICATE");

    const agePunchesForTest = async () => {
      const punches = await prisma.punchEvent.findMany({
        where: { employeeId, terminalId },
        orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }]
      });
      for (const [index, punch] of punches.entries()) {
        await prisma.punchEvent.update({
          where: { id: punch.id },
          data: { recordedAt: new Date(Date.now() - (index + 1) * 6000) }
        });
      }
    };

    await agePunchesForTest();
    const ambiguousPreview = await app.inject({
      method: "POST",
      url: "/api/terminal/preview",
      headers: terminalHeaders,
      payload: { qrToken: reissued.json().token }
    });
    expect(ambiguousPreview.statusCode).toBe(200);
    expect(
      ambiguousPreview.json().choices.map((choice: { eventType: string }) => choice.eventType)
    ).toEqual(["BREAK_START", "EXIT"]);

    const ambiguousKey = crypto.randomUUID();
    const ambiguous = await mark(ambiguousKey);
    expect(ambiguous.statusCode).toBe(409);
    expect(
      ambiguous.json().choices.map((choice: { eventType: string }) => choice.eventType)
    ).toEqual(["BREAK_START", "EXIT"]);
    const breakStart = await mark(ambiguousKey, "BREAK_START");
    expect(breakStart.json().eventType).toBe("BREAK_START");

    await agePunchesForTest();
    const breakEnd = await mark(crypto.randomUUID());
    expect(breakEnd.json().eventType).toBe("BREAK_END");
    await agePunchesForTest();
    const postBreakPreview = await app.inject({
      method: "POST",
      url: "/api/terminal/preview",
      headers: terminalHeaders,
      payload: { qrToken: reissued.json().token }
    });
    expect(postBreakPreview.json().choices).toEqual([{ eventType: "EXIT", label: "Saída final" }]);
    const exit = await mark(crypto.randomUUID());
    expect(exit.json().eventType).toBe("EXIT");
    const recordedEvents = await prisma.punchEvent.findMany({
      where: { employeeId },
      select: { id: true, recordedAt: true }
    });
    await Promise.all(
      recordedEvents.map((event) =>
        prisma.punchEvent.update({
          where: { id: event.id },
          data: { recordedAt: new Date(event.recordedAt.getTime() - 24 * 60 * 60 * 1000) }
        })
      )
    );
    const nextDayPreview = await app.inject({
      method: "POST",
      url: "/api/terminal/preview",
      headers: terminalHeaders,
      payload: { qrToken: reissued.json().token }
    });
    expect(nextDayPreview.json().choices).toEqual([{ eventType: "ENTRY", label: "Entrada" }]);
    const history = await app.inject({
      method: "GET",
      url: `/api/employees/${employeeId}/punches`,
      headers: { authorization }
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toHaveLength(4);

    const invalidQr = await app.inject({
      method: "POST",
      url: "/api/terminal/punch",
      headers: terminalHeaders,
      payload: { qrToken: "x".repeat(32), idempotencyKey: crypto.randomUUID() }
    });
    expect(invalidQr.statusCode).toBe(404);

    await prisma.employee.update({ where: { id: employeeId }, data: { status: "INACTIVE" } });
    const inactiveEmployee = await app.inject({
      method: "POST",
      url: "/api/terminal/punch",
      headers: terminalHeaders,
      payload: { qrToken: reissued.json().token, idempotencyKey: crypto.randomUUID() }
    });
    expect(inactiveEmployee.statusCode).toBe(409);
    await prisma.employee.update({ where: { id: employeeId }, data: { status: "ACTIVE" } });

    await prisma.userEmployeeScope.create({
      data: { userId: managerId, employeeId }
    });
    const managerLogin = {
      json: () => ({
        accessToken: app.jwt.sign({ sub: managerId, email: managerEmail, role: "MANAGER" })
      })
    };
    const managerAuthorization = `Bearer ${managerLogin.json().accessToken as string}`;
    const managerProfile = await app.inject({
      method: "GET",
      url: `/api/employees/${employeeId}/punches`,
      headers: { authorization: managerAuthorization }
    });
    expect(managerProfile.statusCode).toBe(200);
    const exitMark = (
      history.json().items as { id: string; eventType: string; recordedAt: string }[]
    ).find((item) => item.eventType === "EXIT");
    expect(exitMark).toBeDefined();
    const correctedAt = new Date(new Date(exitMark!.recordedAt).getTime() - 1_000);
    const correctionRequest = await app.inject({
      method: "POST",
      url: "/api/attendance-requests",
      headers: { authorization: managerAuthorization },
      payload: {
        employeeId,
        type: "CORRECT_PUNCH",
        targetEventId: exitMark!.id,
        eventType: "EXIT",
        recordedAt: correctedAt.toISOString(),
        reason: "Ajuste de horário solicitado pelo gestor."
      }
    });
    expect(correctionRequest.statusCode).toBe(201);
    const eventBeforeApproval = await prisma.punchEvent.findUnique({
      where: { id: exitMark!.id }
    });
    expect(eventBeforeApproval).toMatchObject({
      eventType: exitMark!.eventType,
      recordedAt: new Date(exitMark!.recordedAt)
    });
    const correctionDecision = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${correctionRequest.json().id as string}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE", reviewComment: "Correção conferida." }
    });
    expect(correctionDecision.statusCode).toBe(200);
    const correctedEvent = await prisma.punchEvent.findUnique({ where: { id: exitMark!.id } });
    expect(correctedEvent).toMatchObject({
      eventType: "EXIT",
      source: "APPROVED_CORRECTION",
      recordedAt: correctedAt
    });
    const managerDirectCorrection = await app.inject({
      method: "PATCH",
      url: `/api/employees/${employeeId}/punches/${exitMark!.id}`,
      headers: { authorization: managerAuthorization },
      payload: {
        eventType: "EXIT",
        recordedAt: correctedAt.toISOString(),
        reason: "Gestor não pode alterar diretamente."
      }
    });
    expect(managerDirectCorrection.statusCode).toBe(403);
    const adminCorrectedAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const adminDirectCorrection = await app.inject({
      method: "PATCH",
      url: `/api/employees/${employeeId}/punches/${exitMark!.id}`,
      headers: { authorization },
      payload: {
        eventType: "EXIT",
        recordedAt: adminCorrectedAt.toISOString(),
        reason: "Ajuste feito diretamente pelo administrador."
      }
    });
    expect(adminDirectCorrection.statusCode).toBe(200);
    expect(adminDirectCorrection.json().item).toMatchObject({
      eventType: "EXIT",
      source: "ADMIN_CORRECTION",
      recordedAt: adminCorrectedAt.toISOString()
    });
    expect(
      await prisma.auditLog.count({
        where: {
          actorId: adminId,
          action: "ADMIN_PUNCH_CORRECTED",
          entityId: exitMark!.id
        }
      })
    ).toBe(1);

    const forgottenDate = saoPauloDateKey(new Date(Date.now() - 72 * 60 * 60 * 1000));
    const forgottenAt = saoPauloInstant(forgottenDate, "08:00");
    const forgottenRequest = await app.inject({
      method: "POST",
      url: "/api/attendance-requests",
      headers: { authorization: managerAuthorization },
      payload: {
        employeeId,
        type: "ADD_PUNCH",
        eventType: "ENTRY",
        recordedAt: forgottenAt.toISOString(),
        reason: "Inclusão de entrada esquecida no dia."
      }
    });
    expect(forgottenRequest.statusCode).toBe(201);
    const forgottenDecision = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${forgottenRequest.json().id as string}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE", reviewComment: "Inclusão conferida." }
    });
    expect(forgottenDecision.statusCode).toBe(200);
    const approvedForgottenRequest = await prisma.attendanceRequest.findUnique({
      where: { id: forgottenRequest.json().id as string }
    });
    const forgottenEvent = await prisma.punchEvent.findUnique({
      where: { id: approvedForgottenRequest!.resultEventId! }
    });
    expect(forgottenEvent).toMatchObject({
      employeeId,
      eventType: "ENTRY",
      source: "APPROVED_MISSING_PUNCH",
      recordedAt: forgottenAt
    });
    const managerDirectVoid = await app.inject({
      method: "DELETE",
      url: `/api/employees/${employeeId}/punches/${forgottenEvent!.id}`,
      headers: { authorization: managerAuthorization },
      payload: { reason: "Gestor não pode anular diretamente." }
    });
    expect(managerDirectVoid.statusCode).toBe(403);
    for (const reason of ["", "curto", "          "]) {
      const invalidVoid = await app.inject({
        method: "DELETE",
        url: `/api/employees/${employeeId}/punches/${forgottenEvent!.id}`,
        headers: { authorization },
        payload: { reason }
      });
      expect(invalidVoid.statusCode).toBe(400);
      expect(
        (await prisma.punchEvent.findUnique({ where: { id: forgottenEvent!.id } }))?.voidedAt
      ).toBeNull();
    }
    const adminVoid = await app.inject({
      method: "DELETE",
      url: `/api/employees/${employeeId}/punches/${forgottenEvent!.id}`,
      headers: { authorization },
      payload: { reason: "Ponto lançado em duplicidade pelo administrador." }
    });
    expect(adminVoid.statusCode).toBe(200);
    expect(adminVoid.json().item).toMatchObject({
      id: forgottenEvent!.id,
      voidReason: "Ponto lançado em duplicidade pelo administrador."
    });
    const retainedVoidedEvent = await prisma.punchEvent.findUnique({
      where: { id: forgottenEvent!.id }
    });
    expect(retainedVoidedEvent?.voidedAt).toBeInstanceOf(Date);
    expect(
      await prisma.auditLog.count({
        where: { actorId: adminId, action: "ADMIN_PUNCH_VOIDED", entityId: forgottenEvent!.id }
      })
    ).toBe(1);
    const employeeHistoryAfterVoid = await app.inject({
      method: "GET",
      url: `/api/employees/${employeeId}/punches?limit=100`,
      headers: { authorization }
    });
    expect(
      employeeHistoryAfterVoid
        .json()
        .items.find((item: { id: string }) => item.id === forgottenEvent!.id).voidedAt
    ).toBeTruthy();

    const sixMarks = [];
    const sixMarksStart = saoPauloInstant(saoPauloDateKey(new Date()), "00:00");
    for (const [index, eventType] of [
      "ENTRY",
      "BREAK_START",
      "BREAK_END",
      "BREAK_START",
      "BREAK_END",
      "EXIT"
    ].entries()) {
      sixMarks.push(
        await prisma.punchEvent.create({
          data: {
            employeeId,
            eventType,
            recordedAt: new Date(sixMarksStart.getTime() + index * 60_000),
            source: "QR_TERMINAL",
            idempotencyKey: crypto.randomUUID()
          }
        })
      );
    }
    const sixIds = sixMarks.map((mark) => mark.id);
    const activeSixCount = () =>
      prisma.punchEvent.count({
        where: { id: { in: sixIds }, voidedAt: null }
      });
    const requestDiscard = (targetEventId: string) =>
      app.inject({
        method: "POST",
        url: "/api/attendance-requests",
        headers: { authorization: managerAuthorization },
        payload: {
          employeeId,
          type: "VOID_PUNCH",
          targetEventId,
          reason: "Marcação repetida por engano no mesmo dia."
        }
      });
    const invalidDiscard = await app.inject({
      method: "POST",
      url: "/api/attendance-requests",
      headers: { authorization: managerAuthorization },
      payload: { employeeId, type: "VOID_PUNCH", reason: "Pedido sem marcação selecionada." }
    });
    expect(invalidDiscard.statusCode).toBe(400);
    const unjustifiedDiscard = await app.inject({
      method: "POST",
      url: "/api/attendance-requests",
      headers: { authorization: managerAuthorization },
      payload: { employeeId, type: "VOID_PUNCH", targetEventId: sixMarks[3]!.id }
    });
    expect(unjustifiedDiscard.statusCode).toBe(400);
    const unscopedDiscard = await app.inject({
      method: "POST",
      url: "/api/attendance-requests",
      headers: { authorization: managerAuthorization },
      payload: {
        employeeId: adminId,
        type: "VOID_PUNCH",
        targetEventId: sixMarks[3]!.id,
        reason: "Tentativa de acessar funcionário fora da equipe."
      }
    });
    expect(unscopedDiscard.statusCode).toBe(403);
    const overviewBeforeDiscards = await app.inject({
      method: "GET",
      url: "/api/employees/overview",
      headers: { authorization }
    });
    expect(overviewBeforeDiscards.statusCode).toBe(200);
    const discardRequest = await requestDiscard(sixMarks[3]!.id);
    expect(discardRequest.statusCode).toBe(201);
    expect(await activeSixCount()).toBe(6);
    const managerApproval = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${discardRequest.json().id}/decision`,
      headers: { authorization: managerAuthorization },
      payload: { decision: "APPROVE", reviewComment: "Tentativa sem permissão." }
    });
    expect(managerApproval.statusCode).toBe(403);
    const approveDiscard = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${discardRequest.json().id}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE", reviewComment: "Confirmado registro excedente." }
    });
    expect(approveDiscard.statusCode).toBe(200);
    expect(await activeSixCount()).toBe(5);
    expect(await prisma.punchEvent.findUnique({ where: { id: sixMarks[3]!.id } })).toMatchObject({
      voidedAt: expect.any(Date),
      voidedById: adminId,
      voidReason: "Marcação repetida por engano no mesmo dia.",
      recordedAt: sixMarks[3]!.recordedAt
    });
    const discardAudit = await prisma.auditLog.findFirst({
      where: {
        actorId: adminId,
        action: "ATTENDANCE_REQUEST_APPROVED",
        entityId: discardRequest.json().id
      }
    });
    expect(JSON.parse(discardAudit!.detailsJson!)).toMatchObject({
      type: "VOID_PUNCH",
      targetEventId: sixMarks[3]!.id,
      reviewComment: "Confirmado registro excedente."
    });
    const repeatDiscardApproval = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${discardRequest.json().id}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE", reviewComment: "Não deve processar duas vezes." }
    });
    expect(repeatDiscardApproval.statusCode).toBe(409);
    expect((await requestDiscard(sixMarks[3]!.id)).statusCode).toBe(404);
    const rejectedDiscard = await requestDiscard(sixMarks[4]!.id);
    expect(rejectedDiscard.statusCode).toBe(201);
    const rejectDiscard = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${rejectedDiscard.json().id}/decision`,
      headers: { authorization },
      payload: { decision: "REJECT", reviewComment: "Manter a marcação para conferência." }
    });
    expect(rejectDiscard.statusCode).toBe(200);
    expect(await activeSixCount()).toBe(5);
    const pendingDiscard = await requestDiscard(sixMarks[4]!.id);
    expect(pendingDiscard.statusCode).toBe(201);
    const directDiscard = await app.inject({
      method: "DELETE",
      url: `/api/employees/${employeeId}/punches/${sixMarks[4]!.id}`,
      headers: { authorization },
      payload: { reason: "Administrador confirmou e descartou diretamente." }
    });
    expect(directDiscard.statusCode).toBe(200);
    expect(await activeSixCount()).toBe(4);
    const staleDiscard = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${pendingDiscard.json().id}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE", reviewComment: "Marcação já descartada diretamente." }
    });
    expect(staleDiscard.statusCode).toBe(409);
    expect(await prisma.punchEvent.count({ where: { id: { in: sixIds } } })).toBe(6);
    const overviewAfterDiscards = await app.inject({
      method: "GET",
      url: "/api/employees/overview",
      headers: { authorization }
    });
    expect(overviewAfterDiscards.statusCode).toBe(200);
    expect(overviewAfterDiscards.json().todayPunches).toBe(
      overviewBeforeDiscards.json().todayPunches - 2
    );
    const discardHistory = await app.inject({
      method: "GET",
      url: `/api/employees/${employeeId}/punches?limit=100`,
      headers: { authorization }
    });
    expect(discardHistory.statusCode).toBe(200);
    expect(
      discardHistory.json().items.filter((mark: { id: string }) => sixIds.includes(mark.id))
    ).toHaveLength(6);

    const waiverRequest = await app.inject({
      method: "POST",
      url: "/api/attendance-requests",
      headers: { authorization: managerAuthorization },
      payload: {
        employeeId,
        type: "HOUR_WAIVER",
        targetDate: saoPauloDateKey(new Date()),
        minutes: 30,
        reason: "Abono aprovado para validar o fluxo de auditoria."
      }
    });
    expect(waiverRequest.statusCode).toBe(201);
    const missingReviewReason = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${waiverRequest.json().id as string}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE" }
    });
    expect(missingReviewReason.statusCode).toBe(400);
    const stillPending = await prisma.attendanceRequest.findUnique({
      where: { id: waiverRequest.json().id as string }
    });
    expect(stillPending?.status).toBe("PENDING");
    const decision = await app.inject({
      method: "POST",
      url: `/api/attendance-requests/${waiverRequest.json().id as string}/decision`,
      headers: { authorization },
      payload: { decision: "APPROVE", reviewComment: "Validado pela administração." }
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().status).toBe("APPROVED");

    const revokedTerminal = await app.inject({
      method: "POST",
      url: `/api/terminals/${terminalId}/revoke`,
      headers: { authorization }
    });
    expect(revokedTerminal.statusCode).toBe(200);
    const deniedTerminal = await app.inject({
      method: "GET",
      url: "/api/terminal/me",
      headers: terminalHeaders
    });
    expect(deniedTerminal.statusCode).toBe(401);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers: { authorization },
      payload: { registration, name: "Outro cadastro" }
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("returns a client error for invalid pagination", async () => {
    const app = await appPromise;
    const login = {
      json: () => ({
        accessToken: app.jwt.sign({ sub: adminId, email: adminEmail, role: "ADMIN" })
      })
    };
    const response = await app.inject({
      method: "GET",
      url: "/api/employees?page=0",
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    expect(response.statusCode).toBe(400);
  });
});
