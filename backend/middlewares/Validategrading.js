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