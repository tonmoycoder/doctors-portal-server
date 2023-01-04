const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 5000;
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const stripe = require('stripe')(
  'sk_test_51M9AC1JuwvDJx01sUEZvWBx8FabParFyHD3xjpLEvGYKA0lEckTmrdQY0yHyb6kjPe3KVJ21IoJtdyDN407FrvFO007FOpAHuc'
);


// nodemailer 

/* function sendBookingEmail(booking){
  const {email,appointmentDate, treatment, slot} = booking;
  let transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY
    }
 }) */


 const auth = {
  auth: {
    api_key: process.env.MAILGUN_EMAIL_API_KEY,
    domain: process.env.EMAIL_SEND_DOMAIN
  }
}

const transporter = nodemailer.createTransport(mg(auth));

 transporter.sendMail({
  from: "SENDER_EMAIL", // verified sender email
  to: email, // recipient email
  subject: `your appointment for ${treatment} is confirmed`, // Subject line
  text: "Hello world!", // plain text body
  html: `<h3>Your appointment is confirmed</h3>
  <div>
  <p>Your appointment for treatment : ${treatment}</p>
  <p>Your appointment date is on ${appointmentDate} at ${slot}</p>
  <p>Thanks for visiting Doctors portal</p>
  </div>

  `, // html body
}, function(error, info){
  if (error) {
    console.log(error);
  } else {
    console.log('Email sent: ' + info.response);
  }
});
}

const app = express();

// middleware

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vtstx9a.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('unauthorized access');
  }
  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'forbidden access' });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appointmentOptions = client.db('doctorsPortal').collection('appointmentOptions');
    const bookingsCollection = client.db('doctorsPortal').collection('bookings');
    const usersCollection = client.db('doctorsPortal').collection('users');
    const doctorsCollection = client.db('doctorsPortal').collection('doctors');
    const paymentsCollection = client.db('doctorsPortal').collection('payments');

    // make sure use verify admin after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(404).send({ message: 'forbidden access' });
      }
      next();
    };

    app.get('/appointmentOptions', async (req, res) => {
      const query = {};
      const date = req.query.date;
      const options = await appointmentOptions.find(query).toArray();
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter((book) => book.treatment === option.name);
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter((slot) => !bookedSlots.includes(slot));
        option.slots = remainingSlots;

        console.log(date, option.name, remainingSlots.length);
      });
      res.send(options);
    });

    /***
     * API Naming Convention
     * app.get('/bookings')
     * app.get('/bookings/:id')
     * app.post('/bookings')
     * app.patch('/bookings/:id')
     * app.delete('/bookings/:id')
     */

    app.get('/users', async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
    });

    app.put('/users/admin/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: 'admin',
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    });

    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' });
      }

      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `oops!you already have booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingsCollection.insertOne(booking);
      // send grid booking
      sendBookingEmail(booking)
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '7d' });
        return res.send({ accessToken: token });
      }
      console.log(user);
      res.status(403).send({ accessToken: '' });
    });

    app.get('/appointmentSpecialty', async (req, res) => {
      const query = {};
      const result = await appointmentOptions.find(query).project({ name: 1 }).toArray();
      res.send(result);
    });

    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });

    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctorQuery = {};
      const result = await doctorsCollection.find(doctorQuery).toArray();
      res.send(result);
    });

    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const kotoNumber = req.params.id;
      const filter = { _id: ObjectId(kotoNumber) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });

    // temporary to update price field on appointment options
    /*  app.get('/addPrice', async (req, res) => {
      const filter = {};
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          price: 999,
        },
      };
      const result = await appointmentOptions.updateMany(filter, updateDoc, options);
      res.send(result);
    }); */

    app.get('/bookings/:payid', async (req, res) => {
      const id = req.params.payid;
      const query = { _id: ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        payment_method_types: ['card'],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });
  } finally {
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('server running mammma');
});

app.listen(port, () => {
  console.log(`server working on port ${port}  mama`);
});
