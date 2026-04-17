# SEED 2: Campana de registro clientes Getalink hacia ChannelAd

## Contexto del Producto

ChannelAd es un marketplace de publicidad en canales cerrados (Telegram, WhatsApp, Discord, newsletters). Getalink es el primer Partner API de ChannelAd. Getalink tiene una base de usuarios ya registrados (anunciantes y creadores) en su propia plataforma de influencer marketing.

## Relacion Getalink-ChannelAd

- Getalink opera campanas via API en ChannelAd (contrato firmado)
- Getalink tiene listados canales propios en Annex E del contrato
- Los usuarios de Getalink NO conocen ChannelAd todavia
- El objetivo es que usuarios de Getalink se registren directamente en ChannelAd para acceder a funcionalidades que Getalink no expone: dashboard completo, metricas detalladas, programa de referrals, Canal Fundador

## Perfiles de Agentes - Base de Usuarios de Getalink

### Anunciantes Pequenos (40% de la base, ~120 usuarios)
- Presupuesto mensual: 200-1,000 euros
- Sector: ecommerce, apps, servicios digitales, infoproductos
- Nivel tech: medio-bajo
- Motivacion: encontrar canales baratos con audiencias nicho
- Dolor actual: gastan en Meta/Google Ads con ROI decreciente, buscan alternativas
- Probabilidad de explorar nueva plataforma: alta si ven inventario relevante
- Tiempo de decision: 1-2 semanas

### Anunciantes Medianos (15% de la base, ~45 usuarios)
- Presupuesto mensual: 1,000-5,000 euros
- Sector: SaaS, fintech, educacion online
- Nivel tech: medio-alto
- Motivacion: diversificar canales de adquisicion, metricas claras
- Dolor actual: dificultad para medir ROI en canales cerrados
- Probabilidad de explorar nueva plataforma: media (necesitan ver caso de exito)
- Tiempo de decision: 2-4 semanas

### Agencias (10% de la base, ~30 usuarios)
- Gestionan multiples clientes
- Presupuesto: variable, 5,000-20,000 euros mensuales agregados
- Motivacion: acceso a inventario exclusivo para diferenciarse de competencia
- Dolor: necesitan reportes profesionales y facturacion centralizada
- Probabilidad: alta si la plataforma ofrece herramientas de agencia
- Tiempo de decision: 3-6 semanas (evaluacion interna)

### Creators/Owners de Canal ya en Getalink (35% de la base, ~105 usuarios)
- Ya monetizan contenido via Getalink (posts patrocinados, stories)
- Plataformas: Instagram, YouTube, TikTok principalmente
- Algunos tambien tienen canales Telegram/WhatsApp como extension
- Motivacion: otra fuente de ingresos, sin esfuerzo adicional
- Dolor: comision alta de Getalink, quieren negociar directamente
- Probabilidad de registro en ChannelAd: media-baja (ya tienen Getalink)
- Factor decisivo: si ChannelAd ofrece mejor comision o mas anunciantes

## Plan de Campana - 4 Semanas

### Semana 1: Activacion Interna
- Getalink menciona ChannelAd en su comunicacion habitual: email semanal, notificacion in-app, mensaje en canal de Telegram propio de Getalink
- Posicionamiento: "partner de publicidad en canales cerrados"
- CTA suave: "explora mas canales en ChannelAd" (link a landing informativa)
- Sin friccion de registro todavia, solo awareness
- Metricas esperadas: 15-25% apertura email, 3-5% click en CTA
- Objetivo: que el nombre "ChannelAd" suene familiar

### Semana 2: Incentivo de Registro
- Usuarios de Getalink que se registren en ChannelAd reciben credito de campana de 20 euros en primera campana
- Landing especifica con URL trackeada desde Getalink (utm_source=getalink)
- Registro simplificado: SSO con cuenta Getalink o registro express (email + password)
- Mide conversion del trafico referido
- Metricas esperadas: 8-15% conversion de visitante a registro
- Segmentacion: email diferenciado para anunciantes vs creators

### Semana 3: Activacion de Canales de Getalink
- Los canales que Getalink tiene listados en Annex E aparecen como "verificados" en ChannelAd
- Badge "Verificado por Getalink" visible en el perfil del canal
- Los anunciantes de Getalink pueden ver estos canales y contratarlos directamente en ChannelAd
- Motivo de registro para anunciantes: acceso a inventario exclusivo ya conocido
- Motivo de registro para creators: sus canales ya estan listados, solo necesitan reclamarlos
- Notificacion a creators: "Tu canal ya esta en ChannelAd, reclama tu perfil"

### Semana 4: Cierre de Loop
- Primera campana ejecutada via ChannelAd con anunciante originado en Getalink
- Caso de exito documentado con metricas reales: impresiones, clics, CTR, coste por resultado
- Getalink comparte el caso de exito con toda su base via email + blog post
- Testimonial del anunciante y del owner del canal
- CTA final: "Unete a los XX anunciantes que ya estan en ChannelAd"

## Variables de Simulacion

- Base total de Getalink: ~300 usuarios (mezcla de anunciantes, agencias, creators)
- Duracion: 30 dias (4 semanas)
- Metrica principal: porcentaje de base de Getalink que se convierte en usuario activo de ChannelAd
- Metricas secundarias: segmento que registra primero (anunciante vs creator), tiempo medio de conversion, tasa de activacion post-registro, friccion de doble cuenta
- Canales en Annex E: 15-25 canales verificados de Getalink

## Fricciones Esperadas

1. Fatiga de plataformas: "ya tengo Getalink, para que otra cuenta?"
2. Duplicacion de esfuerzo: "tengo que gestionar dos dashboards?"
3. Confusion de propuesta de valor: "que tiene ChannelAd que no tenga Getalink?"
4. SSO friction: si no funciona bien, abandonan el registro
5. Credito de 20 euros insuficiente: para anunciantes medianos no es motivacion
6. Canales de Getalink sin reclamar: creators que ignoran la notificacion
7. Primer caso de exito: si no llega en semana 4, el momentum se pierde
8. Competencia interna: Getalink podria no promocionar activamente a un "competidor"

## Pregunta Central de Simulacion

Que porcentaje de la base de Getalink se convierte en usuario activo de ChannelAd en 30 dias con este plan? Que friccion de "doble cuenta" aparece, que segmento de usuario de Getalink tiene mas probabilidad de registrarse primero (anunciante vs creator), y que evento de la semana 3 o 4 podria convertir el interes pasivo en registro activo?
