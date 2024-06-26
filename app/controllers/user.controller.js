
const db = require("../models");
const User = db.users;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Movie = require("../models/movie.model");

exports.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send({ message: "Please provide username and password." });
    }

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).send({ message: "User not found." });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).send({ message: "Invalid credentials." });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, { httpOnly: true });
        return res.status(200).send({ message: "Login successful." });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).send({ message: "Internal server error." });
    }
};

exports.signUp = (req, res) => {
  if (!req.body.email_address || !req.body.password) {
      res.status(400).send({ message: "Please provide email and password to continue." });
      return;
  }
  bcrypt.hash(req.body.password, 10, (err, hashedPassword) => {
      if (err) {
          res.status(500).send({ message: "Error hashing password." });
          return;
      }

      const user = new User({
          email: req.body.email_address,
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          username: req.body.first_name + req.body.last_name,
          password: hashedPassword,
          contact: req.body.mobile_number,
          role: req.body.role ? req.body.role : 'user',
          coupons: [{
            code: "NEW20",
            discount: 20, 
            maxDiscountAmount: 149, 
            minTotalAmount: 499, 
            count: 0,
            maxCount: 2 
          }],
          bookingRequests: []
      });

      user.save()
          .then(data => {
              res.send(data);
          })
          .catch(err => {
              res.status(500).send({
                  message: err.message || "Some error occurred, please try again later."
              });
          });
  });
};


exports.logout = (req, res) => {
  res.clearCookie('token');
  return res.status(200).send({ message: "Logout successful." });
};
  
exports.getCouponCode = (req, res) => {

  jwt.verify(req.cookies.token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized." });
    }

    const userId = decoded.id;

    User.findById(userId)
      .then(user => {if (!user) {
          return res.status(404).send({ message: "User not found." });
        }
        if (user.coupons.length === 0) {
            return res.send({ message: "You don't have any coupons to use." });
          } else{
            return res.send({ coupons: user.coupons });
          }
        res.send({ coupons: user.coupons });
      })
      .catch(err => {
        res.status(500).send({ message: "Error retrieving coupons." });
      });
  });
};

exports.bookShow = async (req, res) => {
    try {

        const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send({ message: "User not found." });
        }

        const { movieId, showId, seats, couponCode } = req.body;

        const movie = await Movie.findById(movieId);

        if (!movie) {
            return res.status(404).send({ message: "Movie not found." });
        }

        const show = movie.shows.find(show => show.id === showId);

        if (!show) {
            return res.status(404).send({ message: "Show not found." });
        }
        const updatedAvailableSeats = parseInt(show.available_seats);

        if (seats > updatedAvailableSeats) {
            return res.status(400).send({ message: "Requested number of seats is not available." });
        }

        const totalAmount = show.unit_price * seats;

        let discountAmount = 0;
        if (couponCode) {
            const couponIndex = user.coupons.findIndex(coupon => coupon.code.toLowerCase() === couponCode.toLowerCase());
            if (couponIndex === -1) {
                return res.status(404).send({ message: "Coupon code not found for the user." });
            }

            const coupon = user.coupons[couponIndex];
            if (coupon.count >= coupon.maxCount) {
                return res.status(400).send({ message: "Coupon code has reached its maximum usage limit." });
            }

            const { discount, maxDiscountAmount, minTotalAmount, maxCount } = coupon;

            if (totalAmount < minTotalAmount) {
                return res.status(400).send({ message: `Minimum total amount of ${minTotalAmount} required to apply this coupon.` });
            }

            discountAmount = Math.min((totalAmount * discount) / 100, maxDiscountAmount);
            coupon.count++;

            if (coupon.count === maxCount) {
                user.coupons = user.coupons.filter(c => c.code.toLowerCase() !== couponCode.toLowerCase());
            }
            
            await User.findByIdAndUpdate(userId, { coupons: user.coupons });
  
        }

        const finalAmount = totalAmount - discountAmount;

        const updatedSeats = updatedAvailableSeats - seats;

        const updatedShow = await Movie.findOneAndUpdate(
            { _id: movieId, 'shows.id': showId },
            { $set: { 'shows.$.available_seats': updatedSeats.toString() } },
            { new: true }
        );

        if (!updatedShow) {
            return res.status(404).send({ message: "Failed to update available seats." });
        }

        const newRefNo = new Date().getTime().toString() + Math.floor(Math.random() * 100).toString();

        user.bookingRequests.push({
            movieId: movie._id,
            showId,
            seats,
            unitPrice: show.unit_price,
            totalAmount: finalAmount,
            reference_number: newRefNo
        });
        await user.save();

        return res.status(200).send({
            reference_number: newRefNo,
            movie_name: movie.title,
            show_time: show.show_timing,
            price_before_coupon: totalAmount,
            price_after_coupon: finalAmount,
            final_amount: finalAmount
        });
    } catch (error) {
        console.error("Error booking show:", error);
        return res.status(500).send({ message: "Internal server error." });
    }
};
