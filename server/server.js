const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Покращені налаштування CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(bodyParser.json());

// Підключення до БД
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

app.use(express.static(path.join(__dirname, '../public'))); 

// Middleware для перевірки підключення до БД
app.use(async (req, res, next) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    next();
  } catch (err) {
    console.error('Помилка підключення до БД:', err);
    res.status(500).json({ success: false, message: 'Помилка бази даних' });
  }
});
app.use(express.static('public'));
// Маршрут для отримання товарів сніданків
app.get('/breakfast-products', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.query(`
      SELECT 
        p.Id,
        p.Name as productName,
        p.Description,
        p.Price,
        pic.Content as imageBlob
      FROM Products p
      LEFT JOIN Pictures pic ON p.PictureId = pic.Id
      WHERE p.CategoryId = 1
    `);

    const products = results.map(row => ({
      id: row.Id,
      name: row.productName,
      description: row.Description,
      price: row.Price,
      image: row.imageBlob 
        ? `data:image/jpeg;base64,${row.imageBlob.toString('base64')}` 
        : null
    }));

    res.json(products);
  } catch (error) {
    console.error('Помилка отримання продуктів:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Помилка сервера при отриманні продуктів' 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Маршрут для отримання різдвяних подарунків
app.get('/xmas-products', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.query(`
      SELECT 
        p.Id,
        p.Name as productName,
        p.Description,
        p.Price,
        pic.Content as imageBlob
      FROM Products p
      LEFT JOIN Pictures pic ON p.PictureId = pic.Id
      WHERE p.CategoryId = 2
    `);

    const products = results.map(row => ({
      id: row.Id,
      name: row.productName,
      description: row.Description,
      price: row.Price,
      image: row.imageBlob 
        ? `data:image/jpeg;base64,${row.imageBlob.toString('base64')}` 
        : null
    }));

    res.json(products);
  } catch (error) {
    console.error('Помилка отримання різдвяних подарунків:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Помилка сервера при отриманні різдвяних подарунків' 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Маршрут для оформлення замовлення
app.post('/place-order', async (req, res) => {
  const { firstName, lastName, phone, email, address, products } = req.body;
  
  if (!firstName || !lastName || !phone || !email || !address || !products?.length) {
    return res.status(400).json({ 
      success: false, 
      message: 'Необхідні дані відсутні' 
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Обробка клієнта
    const [existingClient] = await connection.query(
      'SELECT Id FROM Client WHERE Email = ?', 
      [email]
    );
    
    let clientId;
    if (existingClient.length > 0) {
      clientId = existingClient[0].Id;
      await connection.query(
        'UPDATE Client SET FirstName = ?, LastName = ?, Phone = ? WHERE Id = ?',
        [firstName, lastName, phone, clientId]
      );
    } else {
      const [result] = await connection.query(
        'INSERT INTO Client (FirstName, LastName, Phone, Email) VALUES (?, ?, ?, ?)',
        [firstName, lastName, phone, email]
      );
      clientId = result.insertId;
    }
    
    // 2. Створення замовлення (використовуйте правильну назву стовпця для дати)
    const orderCode = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const [orderResult] = await connection.query(
      'INSERT INTO Orders (OrderCode, DateCreated, ClientId, DeliveryAddress) VALUES (?, NOW(), ?, ?)',
      [orderCode, clientId, address]
    );
    const orderId = orderResult.insertId;
    
    // 3. Додавання товарів
    const productValues = products
      .filter(p => p.id)
      .map(p => [orderId, p.id, p.quantity || 1]);
    
    if (productValues.length > 0) {
      await connection.query(
        'INSERT INTO OrderProduct (OrderId, ProductId, Quantity) VALUES ?',
        [productValues]
      );
    }
    
    await connection.commit();
    
    res.json({ 
      success: true, 
      orderCode,
      orderId,
      clientId
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Помилка оформлення замовлення:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Помилка сервера',
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/submit-review', async (req, res) => {
  const { name, email, rating, comment, orderId } = req.body;

  if (!name || !email || !rating || !comment || isNaN(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Некоректні дані: оцінка повинна бути числом від 1 до 5' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingClient] = await connection.query(
      'SELECT Id FROM Client WHERE Email = ?',
      [email]
    );

    let clientId;
    if (existingClient.length > 0) {
      clientId = existingClient[0].Id;
      await connection.query(
        'UPDATE Client SET FirstName = ? WHERE Id = ?',
        [name, clientId]
      );
    } else {
      const [result] = await connection.query(
        'INSERT INTO Client (FirstName, Email) VALUES (?, ?)',
        [name, email]
      );
      clientId = result.insertId;
    }

    await connection.query(
      'INSERT INTO Reviews (ClientId, OrderId, Rating, Comment) VALUES (?, ?, ?, ?)',
      [clientId, orderId || null, rating, comment]
    );

    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Помилка відправки відгуку:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Помилка сервера' });
  } finally {
    if (connection) connection.release();
  }
});
// Маршрут для пошуку продуктів (оптимізований)
app.get('/api/search', async (req, res) => {
  const query = req.query.query?.trim();
  
  if (!query || query.length < 2) {
    return res.status(400).json({ 
      success: false, 
      message: 'Мінімальна довжина запиту - 2 символи' 
    });
  }

  try {
    const connection = await pool.getConnection();
    const [results] = await connection.query(`
      SELECT 
        p.Id,
        p.Name,
        p.Description,
        p.Price,
        p.CategoryId,
        pic.Content as imageBlob
      FROM Products p
      LEFT JOIN Pictures pic ON p.PictureId = pic.Id
      WHERE p.Name LIKE ? OR p.Description LIKE ?
      LIMIT 10
    `, [`%${query}%`, `%${query}%`]);

    connection.release();

    const products = results.map(row => ({
      id: row.Id,
      name: row.Name,
      description: row.Description,
      price: row.Price,
      categoryId: row.CategoryId,
      image: row.imageBlob 
        ? `data:image/jpeg;base64,${row.imageBlob.toString('base64')}` 
        : null
    }));

    res.json(products);
  } catch (error) {
    console.error('Помилка пошуку:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Помилка сервера при пошуку' 
    });
  }
});

// Маршрут для отримання деталей продукту (оптимізований)
app.get('/api/product/:id', async (req, res) => {
  const productId = req.params.id;

  try {
    const connection = await pool.getConnection();
    const [results] = await connection.query(`
      SELECT 
        p.Id,
        p.Name,
        p.Description,
        p.Price,
        p.CategoryId,
        pic.Content as imageBlob
      FROM Products p
      LEFT JOIN Pictures pic ON p.PictureId = pic.Id
      WHERE p.Id = ?
    `, [productId]);

    connection.release();

    if (results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Продукт не знайдено' 
      });
    }

    const product = {
      id: results[0].Id,
      name: results[0].Name,
      description: results[0].Description,
      price: results[0].Price,
      categoryId: results[0].CategoryId,
      image: results[0].imageBlob 
        ? `data:image/jpeg;base64,${results[0].imageBlob.toString('base64')}` 
        : null
    };

    res.json({ success: true, product });
  } catch (error) {
    console.error('Помилка отримання продукту:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Помилка сервера' 
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Обробка незнайдених маршрутів
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Маршрут не знайдено' });
});

// Обробка помилок
app.use((err, req, res, next) => {
  console.error('Глобальна помилка:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Внутрішня помилка сервера' 
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер працює на http://localhost:${PORT}`);
});