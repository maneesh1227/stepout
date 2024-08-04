const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'trains.db')
let db

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    await createUserTable()

    app.listen(3000, () => {
      console.log('server is running on port 3000')
    })
  } catch (e) {
    console.log(`DB Error ${e.message}`)
    process.exit(1)
  }
}

const createUserTable = async () => {
  const createBookingsTableQuery = `
        CREATE TABLE IF NOT EXISTS bookings (
            booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            train_name TEXT,
            no_of_seats INTEGER,
            seat_numbers TEXT
        );
    `
  await db.run(createBookingsTableQuery)
}

initializeDbAndServer()

// Register API
app.post('/register/', async (request, response) => {
  const {username, password, email} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectUser = `
        SELECT 
        *
        FROM 
        user 
        WHERE 
        username = '${username}'
    `
  const getUserDetails = await db.get(selectUser)
  if (getUserDetails !== undefined) {
    response.status(400).send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400).send('Password is too short')
    } else {
      const postUserQuery = `
                INSERT INTO
                user (username, password, email)
                VALUES('${username}', '${hashedPassword}', '${email}')
            `
      await db.run(postUserQuery)
      response.send('User created successfully')
    }
  }
})

// Login API
app.post('/login/', async (request, response) => {
  console.log('Login Request Body:', request.body) // Log the request body for debugging
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = ?`
  const dbUser = await db.get(selectUserQuery, [username])
  if (dbUser === undefined) {
    response.status(400).send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched) {
      const payload = {username: username, id: dbUser.id}
      const jwtToken = jwt.sign(payload, 'secret')
      response.send({jwtToken})
    } else {
      response.status(400).send('Invalid password')
    }
  }
})

// Add Train API
app.post('/trains/create', async (request, response) => {
  const {
    train_name,
    source,
    destination,
    seat_capacity,
    arrival_time_at_source,
    arrival_time_at_destination,
  } = request.body
  if (
    !train_name ||
    !source ||
    !destination ||
    !seat_capacity ||
    !arrival_time_at_source ||
    !arrival_time_at_destination
  ) {
    return response.status(400).send('All fields are required')
  }
  const addTrainQuery = `
        INSERT INTO
        train (train_name, source, destination, seat_capacity, arrival_time_at_source, arrival_time_at_destination)
        VALUES ('${train_name}', '${source}', '${destination}', ${seat_capacity}, '${arrival_time_at_source}', '${arrival_time_at_destination}')
    `
  try {
    await db.run(addTrainQuery)
    response.send('Train added successfully')
  } catch (error) {
    response.status(400).send(`Error adding train: ${error.message}`)
  }
})

//seat avalibility

app.get('/trains/availability', async (request, response) => {
  const {source, destination} = request.query
  if (!source || !destination) {
    return response.status(400).send('Source and destination are required')
  }

  const getTrainsQuery = `
    SELECT train_name, seat_capacity ,arrival_time_at_source
    FROM train 
    WHERE source = ? AND destination = ?
  `
  try {
    const trains = await db.all(getTrainsQuery, [source, destination])
    const result = trains.map(train => ({
      train_name: train.train_name,
      available_seats: train.seat_capacity,
      arrival_time: train.arrival_time_at_source,
    }))
    response.send(result)
  } catch (error) {
    response.status(400).send(`Error retrieving trains: ${error.message}`)
  }
})

//book a seat
app.post('/trains/:train_name/book', async (request, response) => {
  const {train_name} = request.params
  const {id, no_of_seats} = request.body
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return response.status(401).send('Authorization header missing or invalid')
  }

  const jwtToken = authHeader.split(' ')[1]
  try {
    jwt.verify(jwtToken, 'secret')
  } catch (error) {
    return response.status(401).send('Invalid JWT Token')
  }

  try {
    // Get the available seats for the train
    const getTrainQuery = `
      SELECT seat_capacity 
      FROM train 
      WHERE train_name = ?
    `
    const train = await db.get(getTrainQuery, [train_name])

    if (!train) {
      return response.status(404).send('Train not found')
    }

    // Check if enough seats are available
    if (train.seat_capacity < no_of_seats) {
      return response.status(400).send('Not enough seats available')
    }

    // Generate seat numbers (for simplicity, just sequential numbers)
    const seatNumbers = Array.from(
      {length: no_of_seats},
      (_, i) => train.seat_capacity - no_of_seats + 1 + i,
    ).join(', ')

    // Book the seats
    const bookSeatsQuery = `
      INSERT INTO bookings (user_id, train_name, no_of_seats, seat_numbers)
      VALUES (?, ?, ?, ?)
    `
    const bookingResult = await db.run(bookSeatsQuery, [
      id,
      train_name,
      no_of_seats,
      seatNumbers,
    ])

    // Update the available seats in the train table
    const updateTrainSeatsQuery = `
      UPDATE train 
      SET seat_capacity = seat_capacity - ? 
      WHERE train_name = ?
    `
    await db.run(updateTrainSeatsQuery, [no_of_seats, train_name])

    // Return the booking details
    response.send({
      message: 'Seat booked successfully',
      booking_id: bookingResult.lastID,
      seat_numbers: seatNumbers,
    })
  } catch (error) {
    response.status(500).send(`Error booking seat: ${error.message}`)
  }
})

module.exports = app
