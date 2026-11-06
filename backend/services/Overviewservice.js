const model = require("../models/Overviewmodel");

const centreOf = (q) => (/^\d+$/.test(q.centreId || "") ? parseInt(q.centreId, 10) : null);

async function overview(q) {
  const centreId = centreOf(q);
  const [m, classes, att, grading] = await Promise.all([
    model.money(centreId), model.todayClasses(centreId), model.attention(centreId), model.nextGrading(centreId),
  ]);
  const collected = Number(m.collected), invoiced = Number(m.invoiced);
  return {
    money: {
      collected, invoiced,
      percentInvoiced: invoiced > 0 ? Math.min(100, Math.round((collected / invoiced) * 100)) : null,
      outstanding: Number(m.outstanding), invoiceCount: m.invoiceCount, overdue: m.overdue,
    },
    classes: classes.rows.map((c) => ({ ...c })),
    classesTotal: classes.total,
    attention: { reportedPayments: att.reported, gradingResults: att.drafts, conflicts: att.conflicts },
    nextGrading: grading,
  };
}

async function portal(user) {
  const s = await model.portalStudent(user.userId);
  if (!s) return null;
  const [invoices, classes] = await Promise.all([
    s.studentId ? model.portalInvoices(s.studentId) : [],
    s.centreId ? model.portalClasses(s.centreId) : [],
  ]);
  return {
    name: s.fullName, centre: s.centre, memberId: s.studentCode || null, linked: !!s.studentId,
    invoices: invoices.map((i) => ({ ...i, amount: Number(i.amount) })), classes,
  };
}

module.exports = { overview, portal };
