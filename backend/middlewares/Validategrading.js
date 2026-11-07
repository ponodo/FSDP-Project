const Joi = require("joi");

// Runs a Joi schema on req.body; replaces body with the cleaned value
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body || {}, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error)
    return res
      .status(400)
      .json({ error: error.details.map((d) => d.message).join("; ") });
  req.body = value;
  next();
};

const id = Joi.number().integer().positive();
const ymd = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ "string.pattern.base": "{#label} must be a date (YYYY-MM-DD)" });
const hhmm = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).messages({ "string.pattern.base": "{#label} must be a time (HH:MM)" });

// Fields shared by the availability check and the session form
const slot = {
  centreId: id.required(),
  venue: Joi.string().trim().min(1).max(50).required(),
  sessionDate: ymd.required(),
  startTime: hhmm.required(),
  endTime: hhmm.required(),
  leadExaminerId: id.required(),
  supportingExaminerId: id.allow(null).optional(),
};

exports.checkAvailability = validate(
  Joi.object({ ...slot, excludeSessionId: id.allow(null).optional() }),
);

const sessionFields = {
  ...slot,
  type: Joi.string().valid("Mass", "Private").required(),
  title: Joi.string().trim().min(1).max(80).required(),
  capacity: Joi.number().integer().min(1).max(200).required(),
  fee: Joi.number().min(0).max(10000).precision(2).default(0),
  registrationCloses: ymd.allow(null, "").optional(),
};

exports.createSession = validate(
  Joi.object({
    ...sessionFields,
    studentId: id.when("type", { is: "Private", then: Joi.required(), otherwise: Joi.strip() }),
  }).messages({ "any.required": "{#label} is required" }),
);

exports.updateSession = validate(Joi.object(sessionFields));

exports.updateResult = validate(
  Joi.object({
    result: Joi.string().valid("Pass", "Reassess", "Fail").required(),
    newBeltId: id.optional(),
    feedback: Joi.string().trim().max(500).allow("").optional(),
    reviewedById: id.optional(),
  }),
);

exports.publishResults = validate(
  Joi.object({
    resultIds: Joi.array().items(id).min(1).max(200).unique().required(),
    sendEmails: Joi.boolean().default(true),
  }),
);

exports.resendNotification = validate(
  Joi.object({
    email: Joi.string().trim().email({ tlds: { allow: false } }).max(120).optional(),
  }),
);