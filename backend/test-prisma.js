const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();
console.log('PrismaClient criado');
prisma.$disconnect();
