const { z } = require('zod');

const emailSchema = z.string().trim().toLowerCase().email('Email invalide.');

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis.'),
});

const changePasswordSchema = z.object({
  newPassword: z.string()
    .min(10, 'Le mot de passe doit contenir au moins 10 caractères.')
    .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule.')
    .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule.')
    .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.')
    .regex(/[^A-Za-z0-9]/, 'Le mot de passe doit contenir au moins un symbole (ex: @ ! # $ % ...).'),
});

const createUserSchema = z.object({
  email: emailSchema,
  role: z.enum(['clinicien', 'chercheur', 'admin'], {
    errorMap: () => ({ message: 'Rôle invalide.' }),
  }),
});

const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Le code doit contenir exactement 6 chiffres.'),
});

const totpValidateSchema = z.object({
  totpToken: z.string().min(1, 'Token TOTP requis.'),
  code: z.string().regex(/^\d{6}$/, 'Le code doit contenir exactement 6 chiffres.'),
});

module.exports = {
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  totpCodeSchema,
  totpValidateSchema,
  userIdParamSchema,
};